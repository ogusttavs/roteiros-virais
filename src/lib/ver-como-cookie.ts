/**
 * O cookie do "ver como" (E46 PR 2, regra 2): um cookie PRÓPRIO, assinado com o segredo do servidor, que carrega o id do admin, o id da pessoa, o da conta, o do registro e a hora de
 * expiração. Nunca é a sessão da pessoa (nada de senha, cookie ou token do better-auth dela): a sessão real continua sendo a do admin, e o painel só lê este cookie quando a sessão real
 * é de admin e o id dele bate com o do cookie (`ver-como.ts`). Esta parte é pura (sem Next, sem banco), para testar a assinatura e a expiração sem uma requisição.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config";

export const NOME_COOKIE_VER_COMO = "ver_como";

/** 30 minutos (regra 3): passou disso, o modo se desliga sozinho. */
export const DURACAO_VER_COMO_MS = 30 * 60 * 1000;

export type CarregaVerComo = {
  /** O admin que entrou. */
  a: string;
  /** A pessoa vista. */
  p: string;
  /** A conta (cliente) vista. */
  c: number;
  /** O registro em `ver_como_entradas`. */
  r: number;
  /** Quando expira, em milissegundos desde 1970. */
  e: number;
};

/** `httpOnly`, `secure` em produção, `sameSite=lax`, e a vida do cookie é a do modo (regra 2). */
export function opcoesCookieVerComo(maxAgeSegundos: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSegundos,
  };
}

function assinar(valor: string): string {
  return createHmac("sha256", config.auth.secret).update(`ver-como:${valor}`).digest("hex");
}

export function valorCookieVerComo(carga: CarregaVerComo): string {
  const corpo = Buffer.from(JSON.stringify(carga), "utf8").toString("base64url");
  return `${corpo}.${assinar(corpo)}`;
}

export type LeituraDoCookie =
  | { estado: "ausente" }
  /** Com a assinatura certa, mas depois da hora. */
  | { estado: "expirado"; carga: CarregaVerComo }
  /** Estragado, ou assinado por quem não tem o segredo. */
  | { estado: "invalido" }
  | { estado: "valido"; carga: CarregaVerComo };

/** Confere a assinatura (em tempo constante) e a expiração; nunca confia no conteúdo antes de a assinatura bater. */
export function lerCookieVerComo(valor: string | undefined, agora: Date = new Date()): LeituraDoCookie {
  if (!valor) return { estado: "ausente" };
  const separador = valor.lastIndexOf(".");
  if (separador === -1) return { estado: "invalido" };
  const corpo = valor.slice(0, separador);
  const recebida = Buffer.from(valor.slice(separador + 1), "hex");
  const esperada = Buffer.from(assinar(corpo), "hex");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return { estado: "invalido" };

  let carga: CarregaVerComo;
  try {
    const bruto = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Partial<CarregaVerComo>;
    if (typeof bruto.a !== "string" || typeof bruto.p !== "string" || !Number.isInteger(bruto.c) || !Number.isInteger(bruto.r) || typeof bruto.e !== "number") {
      return { estado: "invalido" };
    }
    carga = { a: bruto.a, p: bruto.p, c: bruto.c as number, r: bruto.r as number, e: bruto.e };
  } catch {
    return { estado: "invalido" };
  }
  return carga.e <= agora.getTime() ? { estado: "expirado", carga } : { estado: "valido", carga };
}
