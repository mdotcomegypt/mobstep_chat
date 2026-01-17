// JWT verification utility for Supabase Edge Functions
// Uses the fixed secret key "mobstepchat" as requested

const JWT_SECRET = "mobstepchat";

interface JWTPayload {
  application_id: number;
  identifier: string;
  iat?: number;
  exp?: number;
}

/**
 * Verify and decode a JWT token using the "mobstepchat" secret
 * @param token - JWT token to verify
 * @returns Decoded payload
 */
export async function verifyJWT(token: string): Promise<JWTPayload> {
  try {
    // Split the token into parts
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    // Decode header and payload (convert Base64URL to standard Base64)
    const headerBase64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const header = JSON.parse(atob(headerBase64 + "===".slice((headerBase64.length + 3) % 4)));
    const payload = JSON.parse(atob(payloadBase64 + "===".slice((payloadBase64.length + 3) % 4)));
    
    // Verify the signature using HMAC-SHA256
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    
    // Convert signature from Base64URL to bytes
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    
    // Verify signature
    const isValid = await crypto.subtle.verify(
      "HMAC-SHA-256",
      key,
      signature,
      new TextEncoder().encode(data)
    );
    
    if (!isValid) {
      throw new Error("Invalid JWT signature");
    }
    
    const application_id = Number(payload.application_id);
    const identifier = String(payload.identifier ?? "");
    
    if (!Number.isFinite(application_id)) {
      throw new Error("Missing/invalid application_id claim");
    }
    if (!identifier) {
      throw new Error("Missing/invalid identifier claim");
    }

    // Check expiration if present
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token has expired");
    }

    return { application_id, identifier, iat: payload.iat, exp: payload.exp };
  } catch (error) {
    throw new Error(`Invalid JWT: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract claims from Authorization header
 * @param authHeader - Authorization header value
 * @returns JWT claims including the original token
 */
export async function getClaimsFromAuthHeader(authHeader: string | null): Promise<{ application_id: number; identifier: string; token: string }> {
  if (!authHeader) throw new Error("Missing Authorization header");
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const claims = await verifyJWT(token);
  return { application_id: claims.application_id, identifier: claims.identifier, token };
}
