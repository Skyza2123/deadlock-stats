import crypto from "node:crypto";

const bytesArg = Number(process.argv[2]);
const byteLength = Number.isFinite(bytesArg) && bytesArg > 0 ? Math.floor(bytesArg) : 48;

const secret = crypto.randomBytes(byteLength).toString("base64url");
console.log(`NEXTAUTH_SECRET=${secret}`);
