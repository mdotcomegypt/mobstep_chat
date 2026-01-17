import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getClaimsFromAuthHeader } from "../jwt-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

type SendMessageBody = {
  conversation_id: string;
  sender_type: "customer" | "agent";
  direction: "inbound" | "outbound";
  message_type: "text" | "image" | "action" | "event";
  text?: string | null;
  payload?: unknown;
  client_message_id?: string | null;
  attachments?: Array<{ bucket: string; path: string; mime_type?: string; size_bytes?: number }>;
};

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const authHeader = req.headers.get("authorization");
    const { application_id, identifier, token } = await getClaimsFromAuthHeader(authHeader);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase env vars");

    const user = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const admin = createClient(url, serviceKey);

    const body = (await req.json()) as SendMessageBody;

    if (!body.conversation_id) throw new Error("conversation_id is required");
    if (!body.sender_type) throw new Error("sender_type is required");
    if (!body.direction) throw new Error("direction is required");
    if (!body.message_type) throw new Error("message_type is required");

    const { data: inserted, error: msgErr } = await user
      .from("messages")
      .insert({
        application_id,
        conversation_id: body.conversation_id,
        sender_identifier: identifier,
        sender_type: body.sender_type,
        direction: body.direction,
        message_type: body.message_type,
        text: body.text ?? null,
        payload: body.payload ?? null,
        client_message_id: body.client_message_id ?? null,
      })
      .select("id, created_at")
      .single();

    if (msgErr) throw msgErr;

    const attachments = body.attachments ?? [];
    if (attachments.length > 0) {
      const rows = attachments.map((a) => ({
        application_id,
        message_id: inserted.id,
        bucket: a.bucket,
        path: a.path,
        mime_type: a.mime_type ?? null,
        size_bytes: a.size_bytes ?? null,
      }));
      const { error: attErr } = await admin.from("message_attachments").insert(rows);
      if (attErr) throw attErr;
    }

    return new Response(JSON.stringify({ message_id: inserted.id, created_at: inserted.created_at }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
