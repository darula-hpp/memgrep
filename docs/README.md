# memgrep docs

Documentation site for [memgrep](https://github.com/darula-hpp/memgrep).

- **Live:** [https://memgrep.getuigen.dev](https://memgrep.getuigen.dev)
- **Theme:** zinc + teal (inspired by gitwork)
- **Structure:** content-driven Next.js docs (same pattern as uigen docs)

## Local

```bash
cd docs
npm install
npm run dev
```

Open [http://localhost:4401](http://localhost:4401).

## Deploy (Vercel)

Root directory: `docs`. Production domain: `memgrep.getuigen.dev`.

```bash
cd docs
npx vercel --prod
npx vercel domains add memgrep.getuigen.dev
```

Point DNS for `memgrep.getuigen.dev` at Vercel if the domain add step asks for records.
