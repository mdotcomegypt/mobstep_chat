import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getClaimsFromAuthHeader } from "../jwt-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

type Body = { conversation_id: string };

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
    if (!body.conversation_id) throw new Error("conversation_id is required");

    const { data: me, error: meErr } = await user
      .from("conversation_participants")
      .select("conversation_id")
      .eq("application_id", application_id)
      .eq("conversation_id", body.conversation_id)
      .eq("identifier", identifier)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me) throw new Error("Not a participant");

    const { error: updErr } = await admin
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("application_id", application_id)
      .eq("conversation_id", body.conversation_id)
      .eq("identifier", identifier);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({ ok: true }), {
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
