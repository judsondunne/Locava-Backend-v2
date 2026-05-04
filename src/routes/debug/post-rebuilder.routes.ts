import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";
import { extractMediaProcessingDebugV2 } from "../../lib/posts/master-post-v2/extractMediaProcessingDebugV2.js";
import { hashPostForRebuild } from "../../lib/posts/master-post-v2/hashPostForRebuild.js";
import { diffMasterPostPreview } from "../../lib/posts/master-post-v2/diffMasterPostPreview.js";
import { auditPostEngagementSourcesV2 } from "../../lib/posts/master-post-v2/auditPostEngagementSourcesV2.js";

const ParamsSchema = z.object({ postId: z.string().min(1) });
const WriteSchema = z.object({
  expectedHash: z.string().min(8),
  mode: z.literal("additiveCanonicalFieldsOnly"),
  force: z.boolean().optional().default(false)
});
const RevertSchema = z.object({ backupId: z.string().min(1) });
const PreviewQuerySchema = z.object({
  dryRunMode: z.enum(["default", "singleVideoCheck"]).optional().default("default")
});

const htmlPage = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Post Rebuilder</title>
<style>body{font-family:ui-sans-serif,system-ui;margin:16px}textarea{width:100%;min-height:220px}pre{background:#111;color:#d7e3ff;padding:12px;overflow:auto}button{margin-right:8px;margin-top:8px}section{margin-top:16px;border:1px solid #ddd;padding:12px;border-radius:8px}input,select{padding:8px}</style>
</head><body>
<h2>Master Post V2 One-Post Rebuilder</h2>
<label>Post ID <input id="postId" style="width:420px"/></label>
<button id="loadRaw">Load Raw</button><button id="preview">Preview Canonical</button><button id="write">Write Canonical</button><button id="backups">Backup List</button>
<select id="backupSelect"></select><button id="revert">Revert Selected Backup</button>
<section><h3>Diff Summary</h3><pre id="diff"></pre></section>
<section><h3>Validation</h3><pre id="validation"></pre></section>
<section><h3>Engagement Source Audit</h3><pre id="engagementAudit"></pre></section>
<section><h3>Media Preview</h3><pre id="media"></pre></section>
<section><h3>Engagement Preview</h3><pre id="engagement"></pre></section>
<section><h3>Location</h3><pre id="location"></pre></section>
<section><h3>Raw JSON</h3><textarea id="raw"></textarea></section>
<section><h3>Canonical JSON</h3><textarea id="canonical"></textarea></section>
<section><h3>Media Processing Debug Preview</h3><textarea id="processing"></textarea></section>
<script>
let latestHash=null;let latestValidation=null;
const el=(id)=>document.getElementById(id);
const postId=()=>el("postId").value.trim();
const json=(x)=>JSON.stringify(x,null,2);
async function loadRaw(){const r=await fetch('/debug/post-rebuilder/'+encodeURIComponent(postId())+'/raw');const d=await r.json();latestHash=d.rawHash;el("raw").value=json(d.raw);}
async function preview(){const r=await fetch('/debug/post-rebuilder/'+encodeURIComponent(postId())+'/preview',{method:'POST'});const d=await r.json();latestHash=d.rawHash;latestValidation=d.validation;el("raw").value=json(d.raw);el("canonical").value=json(d.canonicalPreview);el("processing").value=json(d.mediaProcessingDebugPreview);el("diff").textContent=json(d.diffSummary);el("validation").textContent=json(d.validation);
const c=d.canonicalPreview||{};const media=(c.media||{});const assets=(media.assets||[]).map(a=>a.type==='video'?{id:a.id,type:a.type,default:a.video?.playback?.defaultUrl,primary:a.video?.playback?.primaryUrl,startup:a.video?.playback?.startupUrl,highQuality:a.video?.playback?.highQualityUrl,upgrade:a.video?.playback?.upgradeUrl,hls:a.video?.playback?.hlsUrl,fallback:a.video?.playback?.fallbackUrl,preview:a.video?.playback?.previewUrl}:{id:a.id,type:a.type,width:a.image?.width,height:a.image?.height,aspectRatio:a.image?.aspectRatio,display:a.image?.displayUrl,thumbnail:a.image?.thumbnailUrl,original:a.image?.originalUrl});
el("media").textContent=json({cover:media.cover,assetCount:media.assetCount,assetsReady:media.assetsReady,instantPlaybackReady:media.instantPlaybackReady,rawAssetCount:media.rawAssetCount,hasMultipleAssets:media.hasMultipleAssets,primaryAssetId:media.primaryAssetId,coverAssetId:media.coverAssetId,coverDimensions:{width:media.cover?.width,height:media.cover?.height,aspectRatio:media.cover?.aspectRatio},completeness:media.completeness,assets,faststartVerified:assets.filter(a=>a.type==='video').map(a=>a.id+':'+String((media.assets||[]).find(v=>v.id===a.id)?.video?.readiness?.faststartVerified))});
el("engagementAudit").textContent=json(d.engagementSourceAudit||null);
el("engagement").textContent=json({oldLikesArrayCount:Array.isArray(d.raw?.likes)?d.raw.likes.length:0,oldCommentsArrayCount:Array.isArray(d.raw?.comments)?d.raw.comments.length:0,canonicalLikeCount:c.engagement?.likeCount,canonicalCommentCount:c.engagement?.commentCount,recentLikers:c.engagementPreview?.recentLikers,recentComments:c.engagementPreview?.recentComments,preservationNote:'Likers/comments previews mirror production fields; full arrays remain in backup/raw + legacy summaries — canonical stores counts + small preview slices only.'});
el("location").textContent=json({old:{lat:d.raw?.lat,long:d.raw?.long,lng:d.raw?.lng,geohash:d.raw?.geohash,address:d.raw?.address},canonical:c.location,note:'location.display.name is place/address UI — text.title is the post title only.'});
el("write").disabled=Boolean(d.validation?.blockingErrors?.length);}
async function writeCanonical(){if(!latestHash){alert('preview first');return;} const force=confirm('Force write even with blocking errors?'); const r=await fetch('/debug/post-rebuilder/'+encodeURIComponent(postId())+'/write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedHash:latestHash,mode:'additiveCanonicalFieldsOnly',force})});const d=await r.json();alert('write complete: '+(d.backupPath||d.error||'ok'));await listBackups();}
async function listBackups(){const r=await fetch('/debug/post-rebuilder/'+encodeURIComponent(postId())+'/backups');const d=await r.json();const s=el("backupSelect");s.innerHTML='';(d.backups||[]).forEach(b=>{const o=document.createElement('option');o.value=b.backupId;o.textContent=b.backupId;s.appendChild(o);});}
async function revert(){const backupId=el("backupSelect").value;if(!backupId){alert('select backup');return;}const r=await fetch('/debug/post-rebuilder/'+encodeURIComponent(postId())+'/revert',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({backupId})});const d=await r.json();alert(json(d));}
el("loadRaw").onclick=loadRaw;el("preview").onclick=preview;el("write").onclick=writeCanonical;el("backups").onclick=listBackups;el("revert").onclick=revert;
</script></body></html>`;

export async function registerPostRebuilderRoutes(app: FastifyInstance): Promise<void> {
  if (!app.config.ENABLE_POST_REBUILDER_DEBUG_ROUTES) {
    app.log.info("post rebuilder debug routes disabled (ENABLE_POST_REBUILDER_DEBUG_ROUTES!=true)");
    return;
  }

  app.get("/debug/post-rebuilder", async (_request, reply) => reply.type("text/html").send(htmlPage));

  app.get<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/raw", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return { postId: params.postId, exists: false, raw: null, rawHash: hashPostForRebuild(null) };
    const snap = await db.collection("posts").doc(params.postId).get();
    const raw = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
    return { postId: params.postId, exists: snap.exists, raw, rawHash: hashPostForRebuild(raw) };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/preview", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const query = PreviewQuerySchema.parse(request.query ?? {});
    const db = getFirestoreSourceClient();
    if (!db)
      return {
        postId: params.postId,
        rawHash: "",
        raw: null,
        canonicalPreview: null,
        engagementSourceAudit: null,
        mediaProcessingDebugPreview: null,
        validation: {
          status: "invalid",
          blockingErrors: [{ code: "firestore_unavailable", message: "Firestore unavailable", blocking: true }],
          warnings: []
        },
        diffSummary: {},
        writeAllowed: false
      };
    const snap = await db.collection("posts").doc(params.postId).get();
    const raw = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
    const rawHash = hashPostForRebuild(raw);
    if (!raw) {
      return {
        postId: params.postId,
        rawHash,
        raw: null,
        canonicalPreview: null,
        engagementSourceAudit: null,
        mediaProcessingDebugPreview: null,
        validation: {
          status: "invalid",
          blockingErrors: [{ code: "post_not_found", message: "Post does not exist", blocking: true }],
          warnings: []
        },
        diffSummary: {},
        writeAllowed: false
      };
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    const normalized = normalizeMasterPostV2(raw, { postId: params.postId, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    const mediaProcessingDebugPreview = extractMediaProcessingDebugV2(raw);
    const diffSummary = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: [...normalized.warnings, ...validation.warnings],
      errors: [...normalized.errors, ...validation.blockingErrors],
      processingDebugExtracted: Boolean(mediaProcessingDebugPreview)
    });
    const previewChecks =
      query.dryRunMode === "singleVideoCheck"
        ? {
            mediaAssetCountAfterIsOne: normalized.canonical.media.assetCount === 1,
            mediaKindIsVideo: normalized.canonical.classification.mediaKind === "video",
            compatibilityStillExists:
              Boolean(normalized.canonical.compatibility.photoLink) &&
              Boolean(normalized.canonical.compatibility.displayPhotoLink) &&
              Boolean(normalized.canonical.compatibility.photoLinks2 ?? normalized.canonical.compatibility.fallbackVideoUrl),
            hasMp4ImageAssets: normalized.canonical.media.assets.some(
              (asset) => asset.type === "image" && /\.mp4(\?|$)/i.test(asset.image?.displayUrl ?? "")
            )
          }
        : null;
    return {
      postId: params.postId,
      rawHash,
      raw,
      canonicalPreview: normalized.canonical,
      engagementSourceAudit,
      mediaProcessingDebugPreview,
      validation,
      diffSummary,
      previewChecks,
      writeAllowed: validation.blockingErrors.length === 0
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/write", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = WriteSchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const postRef = db.collection("posts").doc(params.postId);
    const snap = await postRef.get();
    if (!snap.exists) return reply.status(404).send({ error: "post_not_found" });
    const raw = (snap.data() ?? {}) as Record<string, unknown>;
    const rawHash = hashPostForRebuild(raw);
    if (rawHash !== body.expectedHash) {
      return reply.status(409).send({ error: "stale_hash", expectedHash: body.expectedHash, currentHash: rawHash });
    }
    const engagementSourceAudit = await auditPostEngagementSourcesV2(db, params.postId, raw);
    const normalized = normalizeMasterPostV2(raw, { postId: params.postId, strict: true, engagementSourceAudit });
    const validation = validateMasterPostV2(normalized.canonical, { engagementSourceAudit });
    if (validation.blockingErrors.length > 0 && !body.force) {
      return reply.status(422).send({ error: "blocking_validation_errors", validation });
    }
    const mediaProcessingDebugPreview = extractMediaProcessingDebugV2(raw);
    const ts = Date.now();
    const backupId = `${params.postId}_${ts}`;
    const backupPath = `postCanonicalBackups/${backupId}`;
    await db.collection("postCanonicalBackups").doc(backupId).set({
      postId: params.postId,
      createdAt: new Date().toISOString(),
      rawBefore: raw,
      rawHash,
      canonicalPreview: normalized.canonical,
      engagementSourceAudit,
      mediaProcessingDebugPreview: mediaProcessingDebugPreview ?? null,
      actor: { route: "debug/post-rebuilder/write" }
    });
    const canonicalToWrite = {
      ...normalized.canonical,
      audit: {
        ...normalized.canonical.audit,
        backupDocPath: backupPath
      }
    };
    await postRef.set(canonicalToWrite, { merge: true });
    if (mediaProcessingDebugPreview) {
      await postRef.collection("mediaProcessingDebug").doc("masterPostV2").set(mediaProcessingDebugPreview, { merge: true });
    }
    const fieldsWritten = [
      "schema","lifecycle","author","text","location","classification","media","engagement","engagementPreview","ranking","compatibility","legacy","audit"
    ];
    return {
      backupId,
      backupPath,
      canonical: canonicalToWrite,
      validation,
      fieldsWritten,
      mediaProcessingDebugWritten: Boolean(mediaProcessingDebugPreview)
    };
  });

  app.get<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/backups", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const db = getFirestoreSourceClient();
    if (!db) return { postId: params.postId, backups: [] };
    const snap = await db.collection("postCanonicalBackups").where("postId", "==", params.postId).orderBy("createdAt", "desc").limit(30).get();
    return {
      postId: params.postId,
      backups: snap.docs.map((doc) => ({ backupId: doc.id, ...(doc.data() ?? {}) }))
    };
  });

  app.post<{ Params: { postId: string } }>("/debug/post-rebuilder/:postId/revert", async (request, reply) => {
    const params = ParamsSchema.parse(request.params);
    const body = RevertSchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const backupSnap = await db.collection("postCanonicalBackups").doc(body.backupId).get();
    if (!backupSnap.exists) return reply.status(404).send({ error: "backup_not_found" });
    const backup = (backupSnap.data() ?? {}) as Record<string, any>;
    if (backup.postId !== params.postId) return reply.status(400).send({ error: "backup_post_mismatch" });
    const rawBefore = backup.rawBefore;
    await db.collection("posts").doc(params.postId).set(rawBefore, { merge: false });
    await db.collection("posts").doc(params.postId).collection("mediaProcessingDebug").doc("revertAudit").set({
      backupId: body.backupId,
      revertedAt: new Date().toISOString(),
      action: "restore_rawBefore_exact"
    }, { merge: true });
    return { success: true, postId: params.postId, backupId: body.backupId, restoredAt: new Date().toISOString() };
  });
}
