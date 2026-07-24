import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { saveToB2, readFromB2 } from "../lib/b2";

async function main() {
  await saveToB2("test/hello.json.gz", { message: "Chuvarada B2 funcionando!", at: new Date().toISOString() });
  console.log("Salvo com sucesso.");
  const result = await readFromB2("test/hello.json.gz");
  console.log("Lido de volta:", JSON.stringify(result));
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
