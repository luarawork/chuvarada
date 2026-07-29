import dotenv from "dotenv";
import "@testing-library/jest-dom";

// lib/supabase.ts lança um erro em tempo de import se as env vars do
// Supabase não estiverem definidas -- qualquer teste futuro que importe
// (direta ou indiretamente) algo que toque esse módulo precisa delas
// carregadas. O Vitest não carrega .env.local sozinho como o Next.js faz --
// precisa ser explícito aqui, mesmo padrão usado em todos os scripts Node
// do projeto (require("dotenv").config(...)).
dotenv.config({ path: ".env.local" });
