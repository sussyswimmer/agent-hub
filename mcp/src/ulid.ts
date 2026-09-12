// ULID (Crockford base32, 48-bit time + 80-bit random), monotonic within a millisecond.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
let lastRandom: number[] = [];

function randomBytes(n: number): number[] {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return [...out];
}

export function ulid(now = Date.now()): string {
  let random: number[];
  if (now === lastTime) {
    random = lastRandom.slice();
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i]! < 255) { random[i]!++; break; }
      random[i] = 0;
    }
  } else {
    random = randomBytes(10);
  }
  lastTime = now;
  lastRandom = random;
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) { time = ALPHABET[t % 32] + time; t = Math.floor(t / 32); }
  // 80 random bits → 16 base32 chars.
  let bits = 0n;
  for (const b of random) bits = (bits << 8n) | BigInt(b);
  let rand = "";
  for (let i = 0; i < 16; i++) { rand = ALPHABET[Number(bits & 31n)] + rand; bits >>= 5n; }
  return time + rand;
}
