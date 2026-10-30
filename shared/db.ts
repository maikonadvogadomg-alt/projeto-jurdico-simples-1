import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// 🔧 28/10: antes, sem DATABASE_URL isto DERRUBAVA o servidor na hora de ligar
// (e a tela só via "Failed to fetch" / tela azul). Agora só avisa: o storage.ts
// percebe que não há banco e passa a salvar no arquivo local (FileStorage).
// Para usar o Neon/Supabase: cole o endereço em Configurações → Banco de dados.
if (!process.env.DATABASE_URL) {
  console.warn("[db] Sem DATABASE_URL — o jurídico vai salvar no arquivo local (sem banco na nuvem).");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
