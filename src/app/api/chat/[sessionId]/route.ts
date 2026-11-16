import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { ChatService } from "@/modules/whatsapp/chat.service";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden" }, { status: 403 });
        }

        // Get the database Session ID (cuid) from the sessionId string
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: 'Session not found' }, { status: 404 });
        }

        const query = request.nextUrl.searchParams;
        const before = query.get("before");
        const beforeJid = query.get("beforeJid");
        if ((before !== null || beforeJid !== null) &&
            (!before || !beforeJid || beforeJid.length > 200 || !Number.isFinite(Date.parse(before)))) {
            return NextResponse.json({ status: false, message: "Invalid chat cursor" }, { status: 400 });
        }

        const limit = 50;
        const chats = await ChatService.getChatsList(session.id, limit + 1, before ?? undefined, undefined, "all", beforeJid ?? undefined);
        const data = chats.slice(0, limit);
        const last = data.at(-1);
        const nextCursor = chats.length > limit && last
            ? { before: last.lastMessage.timestamp, beforeJid: last.jid }
            : null;
        return NextResponse.json({ status: true, data, nextCursor });
    } catch (error) {
        console.error("Chat API error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch chats", error: 'Failed to fetch chats' }, { status: 500 });
    }
}
