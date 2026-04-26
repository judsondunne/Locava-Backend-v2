import { getCoherenceProvider } from "../runtime/coherence-provider.js";

export const globalCache = getCoherenceProvider().cache;
