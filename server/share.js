const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SHARE_FILE = path.join(__dirname, "shares.json");
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// fun readable word lists — xermore style: short, friendly
const ADJECTIVES = [
  "brave",
  "calm",
  "swift",
  "bright",
  "cozy",
  "lively",
  "gentle",
  "happy",
  "jolly",
  "kind",
  "merry",
  "noble",
  "playful",
  "quirky",
  "radiant",
  "silly",
  "witty",
  "zesty",
  "daring",
  "eager",
  "fancy",
  "vivid",
  "tidy",
  "cheery",
  "sunny",
  "crisp",
  "mellow",
  "breezy",
  "glad",
  "snug",
  "peachy",
  "zesty",
  "lush",
  "peaceful",
  "dandy",
  "spry",
  "perky",
  "nimble",
  "candy",
  "fuzzy",
];
const NOUNS = [
  "river",
  "sunset",
  "meadow",
  "canyon",
  "grove",
  "harbor",
  "island",
  "juniper",
  "luna",
  "nova",
  "ocean",
  "pine",
  "quartz",
  "valley",
  "whisper",
  "zephyr",
  "breeze",
  "dawn",
  "ember",
  "frost",
  "aurora",
  "comet",
  "dune",
  "echo",
  "fern",
  "hollow",
  "iris",
  "kite",
  "maple",
  "orchid",
  "plaza",
  "quill",
  "ridge",
  "summit",
  "tide",
  "umber",
  "willow",
  "yonder",
  "acorn",
  "blossom",
];

function randomWord(arr) {
  return arr[crypto.randomInt(arr.length)];
}

function generateSlug() {
  // 3 words: adj-adj-noun or adj-noun-noun — keep it fun and memorable
  const a1 = randomWord(ADJECTIVES);
  const a2 = randomWord(ADJECTIVES);
  const n = randomWord(NOUNS);
  // ensure not repeating same word
  if (a1 === a2) return generateSlug();
  return `${a1}-${n}-${a2}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

class ShareStore {
  constructor() {
    this.map = new Map();
    this.load();
    // cleanup every hour
    setInterval(() => this.purgeExpired(), 60 * 60 * 1000).unref();
  }

  load() {
    try {
      if (fs.existsSync(SHARE_FILE)) {
        const data = JSON.parse(fs.readFileSync(SHARE_FILE, "utf8"));
        for (const [k, v] of Object.entries(data)) {
          if (v.expiresAt > Date.now()) this.map.set(k, v);
        }
      }
    } catch {}
  }

  save() {
    try {
      const obj = Object.fromEntries(this.map.entries());
      fs.writeFileSync(SHARE_FILE, JSON.stringify(obj, null, 2));
    } catch {}
  }

  purgeExpired() {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of this.map.entries()) {
      if (v.expiresAt <= now) {
        this.map.delete(k);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  create({ equations, bounds, sessionId }) {
    this.purgeExpired();
    let slug;
    let tries = 0;
    do {
      slug = generateSlug();
      tries++;
      // after 5 tries, add random suffix to avoid collision
      if (tries > 5) slug += `-${crypto.randomInt(100)}`;
    } while (this.map.has(slug) && tries < 20);

    const now = Date.now();
    const entry = {
      equations: equations.filter(
        (e) => typeof e === "string" && e.trim() !== "",
      ),
      bounds: { ...bounds },
      sessionId: sessionId || null,
      createdAt: now,
      expiresAt: now + TTL_MS,
      hits: 0,
    };
    this.map.set(slug, entry);
    this.save();
    return { slug, entry };
  }

  get(slug) {
    this.purgeExpired();
    const e = this.map.get(slug);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.map.delete(slug);
      this.save();
      return null;
    }
    e.hits = (e.hits || 0) + 1;
    // don't save on every hit to avoid IO, save occasionally
    if (e.hits % 10 === 0) this.save();
    return e;
  }

  // for debugging
  size() {
    return this.map.size;
  }
}

module.exports = { ShareStore, TTL_MS, generateSlug };
