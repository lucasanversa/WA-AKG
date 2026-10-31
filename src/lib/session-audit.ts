import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { logger } from "./logger";

/**
 * Persistent connection audit trail (data/logs/session-events.log, one JSON per line)
 * and optional e-mail alert when a session that was connected goes down.
 */

const LOG_DIR = path.resolve(process.cwd(), "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "session-events.log");

export type SessionEvent = {
    sessionId: string;
    name?: string | null;
    event: "connected" | "closed" | "logged_out" | "auto_stopped" | "qr_expired_stopped" | "stopped";
    code?: number | null;
    reason?: string | null;
};

export async function recordSessionEvent(e: SessionEvent) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n";
    try {
        await mkdir(LOG_DIR, { recursive: true });
        await appendFile(LOG_FILE, line);
    } catch (err) {
        logger.error("Audit", "Failed to write session event:", err);
    }
}

/** Short reason from a Baileys disconnect error, e.g. "conflict:device_removed". */
export function disconnectReason(error: any): string | null {
    const node = error?.data?.content?.[0] ?? error?.data;
    const tag = typeof node?.tag === "string" ? node.tag : null;
    const type = typeof node?.attrs?.type === "string" ? node.attrs.type : null;
    if (tag) return type ? `${tag}:${type}` : tag;
    return typeof error?.message === "string" ? error.message.slice(0, 200) : null;
}

const REASON_TEXT: Record<string, string> = {
    "conflict:device_removed": "o WhatsApp removeu este aparelho conectado (alguém clicou em Sair no celular ou o WhatsApp derrubou a conexão)",
    "conflict:replaced": "outra conexão abriu com a mesma sessão",
};

/** Sends a plain-text alert via Resend when ALERT_* env vars are set; never throws. */
export async function alertSessionDown(e: SessionEvent) {
    const key = process.env.ALERT_RESEND_API_KEY;
    const from = process.env.ALERT_EMAIL_FROM;
    const to = (process.env.ALERT_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!key || !from || to.length === 0) return;

    const label = e.name ? `${e.name} (${e.sessionId})` : e.sessionId;
    const why = (e.reason && REASON_TEXT[e.reason]) || e.reason || "motivo não informado";
    const what = e.event === "logged_out"
        ? "foi desconectada e precisa escanear o QR de novo"
        : "caiu e não conseguiu reconectar sozinha";
    const base = process.env.BASE_URL || "";

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                from,
                to,
                subject: `WhatsApp caiu: ${label}`,
                text:
                    `A sessão ${label} ${what}.\n\n` +
                    `Motivo: ${why}${e.code ? ` (código ${e.code})` : ""}.\n` +
                    `Quando: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.\n\n` +
                    `Reconectar: ${base}/dashboard`,
            }),
            redirect: "manual",
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) logger.error("Audit", `Alert e-mail failed: HTTP ${res.status}`);
    } catch (err) {
        logger.error("Audit", "Alert e-mail failed:", err);
    }
}
