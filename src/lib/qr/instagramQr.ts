import { QRCodeCanvas } from "@loskir/styled-qr-code-node";
import { createCanvas, loadImage } from "canvas";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface GenerateInstagramStyleQrOptions {
  data: string;
  size?: number;
  logoUrl?: string;
}

interface GeneratePosterQrOptions {
  data: string;
  size?: number;
  logoUrl?: string;
}

const DEFAULT_LOGO_URL = "https://locava.app/assets/logo.png";

async function createLocavaLogoWithWhiteBackground(logoUrl: string, size: number): Promise<string> {
  const logoImage = await loadImage(logoUrl);

  const originalWidth = logoImage.width;
  const originalHeight = logoImage.height;
  const aspectRatio = originalWidth / originalHeight;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);

  const maxLogoSize = size * 0.9;
  const logoWidth = aspectRatio > 1 ? maxLogoSize : maxLogoSize * aspectRatio;
  const logoHeight = aspectRatio > 1 ? maxLogoSize / aspectRatio : maxLogoSize;

  const x = (size - logoWidth) / 2;
  const y = (size - logoHeight) / 2;
  ctx.drawImage(logoImage, x, y, logoWidth, logoHeight);

  const pngBuffer = canvas.toBuffer("image/png");
  const tempFilePath = path.join(os.tmpdir(), `locava-qr-logo-${Date.now()}.png`);
  fs.writeFileSync(tempFilePath, pngBuffer);
  return tempFilePath;
}

async function withMaybeTempLogoPath<T>(
  logoUrl: string,
  fn: (localPath: string | null) => Promise<T>
): Promise<T> {
  let tempLogoPath: string | null = null;
  try {
    tempLogoPath = await createLocavaLogoWithWhiteBackground(logoUrl, 400);
  } catch {
    tempLogoPath = null;
  }

  try {
    return await fn(tempLogoPath);
  } finally {
    if (tempLogoPath) {
      try {
        if (fs.existsSync(tempLogoPath)) fs.unlinkSync(tempLogoPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export async function generateInstagramStyleQrPngBuffer({
  data,
  size = 4000,
  logoUrl = DEFAULT_LOGO_URL
}: GenerateInstagramStyleQrOptions): Promise<Buffer> {
  return withMaybeTempLogoPath(logoUrl, async (tempLogoPath) => {
    const qr = new QRCodeCanvas({
      width: size,
      height: size,
      data,
      margin: 24,
      qrOptions: { errorCorrectionLevel: "H" },
      dotsOptions: {
        type: "dots",
        color: "#1b5e20",
        gradient: {
          type: "linear",
          rotation: Math.PI / 2,
          colorStops: [
            { offset: 0, color: "#1b5e20" },
            { offset: 0.3, color: "#2e7d32" },
            { offset: 0.6, color: "#388e3c" },
            { offset: 1, color: "#2e7d32" }
          ]
        }
      },
      cornersSquareOptions: {
        type: "extra-rounded",
        gradient: {
          type: "linear",
          rotation: Math.PI / 2,
          colorStops: [
            { offset: 0, color: "#1b5e20" },
            { offset: 1, color: "#2e7d32" }
          ]
        }
      },
      cornersDotOptions: {
        type: "dot",
        gradient: {
          type: "linear",
          rotation: Math.PI / 2,
          colorStops: [
            { offset: 0, color: "#1b5e20" },
            { offset: 1, color: "#2e7d32" }
          ]
        }
      },
      backgroundOptions: { color: "#FFFFFF" },
      ...(tempLogoPath
        ? {
            image: tempLogoPath,
            imageOptions: {
              margin: 12,
              imageSize: 0.3,
              hideBackgroundDots: true,
              crossOrigin: "anonymous"
            }
          }
        : {})
    });

    const buffer = await qr.toBuffer("png");
    if (!buffer) throw new Error("toBuffer returned null/undefined");
    return buffer as Buffer;
  });
}

export async function generatePosterStyleQrPngBuffer({
  data,
  size = 4000,
  logoUrl = DEFAULT_LOGO_URL
}: GeneratePosterQrOptions): Promise<Buffer> {
  return withMaybeTempLogoPath(logoUrl, async (tempLogoPath) => {
    const qr = new QRCodeCanvas({
      width: size,
      height: size,
      data,
      margin: 24,
      qrOptions: { errorCorrectionLevel: "H" },
      dotsOptions: {
        type: "dots",
        color: "#FFFFFF"
      },
      cornersSquareOptions: {
        type: "extra-rounded",
        color: "#FFFFFF"
      },
      cornersDotOptions: {
        type: "dot",
        color: "#FFFFFF"
      },
      backgroundOptions: {
        color: "transparent"
      },
      ...(tempLogoPath
        ? {
            image: tempLogoPath,
            imageOptions: {
              margin: 12,
              imageSize: 0.3,
              hideBackgroundDots: true,
              crossOrigin: "anonymous"
            }
          }
        : {})
    });

    const buffer = await qr.toBuffer("png");
    if (!buffer) throw new Error("toBuffer returned null/undefined");
    return buffer as Buffer;
  });
}
