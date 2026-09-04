// ============================================================
// CONFIG — fill these in before deploying (see README.md)
// ============================================================
const CONFIG = {
  // 1. Go to https://jsonbin.io, make a free account.
  // 2. Create a new bin with this exact starting content:
  //    {"events":[],"dressCode":{"options":[]}}
  // 3. Copy the Bin ID and paste it below.
  JSONBIN_BIN_ID: "6a9ab942da38895dfe385b4e",

  // 4. In jsonbin.io, go to API Keys and copy your "X-Master-Key".
  JSONBIN_API_KEY: "$2a$10$3TEoQWaHYFK/XNplb1tBIuVxKr56Vxvt3iaRqvMXnUkBaGjO779EG",

  // 5. Set any password you like — this is what makes someone "admin".
  //    NOTE: this is a simple client-side password, fine for a casual
  //    private event ballot, not meant for high-security use.
  ADMIN_PASSWORD: "changeme",

  // How often (ms) to auto-refresh everyone's screen with the latest votes.
  POLL_INTERVAL: 3000
};
