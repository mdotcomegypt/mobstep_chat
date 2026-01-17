import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getClaimsFromAuthHeader } from "../jwt-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

type Body = {
  action_id: string;
  result: unknown;
  message_direction?: "inbound" | "outbound";
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

    const body = (await req.json()) as Body;
    if (!body.action_id) throw new Error("action_id is required");

    const { data: action, error: actionErr } = await admin
      .from("conversation_actions")
      .select("id, conversation_id, assigned_to, status")
      .eq("application_id", application_id)
      .eq("id", body.action_id)
      .single();
    if (actionErr) throw actionErr;
    if (action.status !== "pending") throw new Error("Action is not pending");

    const { data: me, error: meErr } = await user
      .from("conversation_participants")
      .select("role")
      .eq("application_id", application_id)
      .eq("conversation_id", action.conversation_id)
      .eq("identifier", identifier)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me) throw new Error("Not a participant");

    if (me.role !== action.assigned_to) {
      throw new Error("You are not allowed to submit this action");
    }

    const now = new Date().toISOString();
    const { error: updErr } = await admin
      .from("conversation_actions")
      .update({ status: "completed", result: body.result, updated_at: now, completed_at: now })
      .eq("application_id", application_id)
      .eq("id", body.action_id);
    if (updErr) throw updErr;

    const direction = body.message_direction ?? "inbound";
    const { data: msg, error: msgErr } = await admin
      .from("messages")
      .insert({
        application_id,
        conversation_id: action.conversation_id,
        sender_identifier: identifier,
        sender_type: me.role === "agent" ? "agent" : "customer",
        direction,
        message_type: "event",
        text: null,
        payload: { action_id: body.action_id, event: "completed", result: body.result },
      })
      .select("id")
      .single();
    if (msgErr) throw msgErr;

    return new Response(JSON.stringify({ ok: true, message_id: msg.id }), {
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
