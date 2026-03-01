import { missingTargetError } from "../infra/outbound/target-errors.js";
import { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "./normalize.js";

export type WhatsAppOutboundTargetResolution =
  | { ok: true; to: string }
  | { ok: false; error: Error };

export function resolveWhatsAppOutboundTarget(params: {
  to: string | null | undefined;
  allowFrom: Array<string | number> | null | undefined;
  mode: string | null | undefined;
}): WhatsAppOutboundTargetResolution {
  const trimmed = params.to?.trim() ?? "";
  const allowListRaw = (params.allowFrom ?? [])
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  const hasWildcard = allowListRaw.includes("*");
  const allowList = allowListRaw
    .filter((entry) => entry !== "*")
    .map((entry) => normalizeWhatsAppTarget(entry))
    .filter((entry): entry is string => Boolean(entry));

  if (trimmed) {
    const normalizedTo = normalizeWhatsAppTarget(trimmed);
    if (!normalizedTo) {
      return {
        ok: false,
        error: missingTargetError("WhatsApp", "<E.164|group JID>"),
      };
    }
    if (isWhatsAppGroupJid(normalizedTo)) {
      return { ok: true, to: normalizedTo };
    }
    // Explicit outbound sends (e.g. `openclaw message send --target ...`) should
    // accept any valid direct target. `allowFrom` is an inbound/implicit guard.
    if (params.mode === "explicit") {
      return { ok: true, to: normalizedTo };
    }

    // For implicit/heartbeat delivery, keep allowFrom enforcement.
    if (hasWildcard || allowList.length === 0) {
      return { ok: true, to: normalizedTo };
    }
    if (allowList.includes(normalizedTo)) {
      return { ok: true, to: normalizedTo };
    }
    return {
      ok: false,
      error: missingTargetError("WhatsApp", "<E.164|group JID>"),
    };
  }

  return {
    ok: false,
    error: missingTargetError("WhatsApp", "<E.164|group JID>"),
  };
}
