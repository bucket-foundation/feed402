import { ingestPeople } from "../_lib/people.js";
ingestPeople({
  outDir: "./datasets/math-history",
  providerName: "math-history",
  topicLabel: "mathematician",
  occupationQids: ["Q170790"], // mathematician
  limit: 2000,
}).catch(e => { console.error(e); process.exit(1); });
