import { NextResponse } from "next/server";

import { saudeDaViagem } from "@/servicos/admin-acompanhamento";

export const dynamic = "force-dynamic";

/**
 * Saúde ampliada do acompanhamento da viagem (V10, item 3): sem sessão,
 * igual `/api/saude` (a lista de rotas públicas do middleware casa por
 * prefixo, `/api/saude` cobre esta sub-rota também). Devolve só contagens
 * e horários, nenhum dado de cliente (nem nome, nem tema, nem texto): por
 * isso `saudeDaViagem` já vem sem mensagem de erro nem motivo de
 * reprovação, só o que um monitor externo precisa para saber se o motor
 * está rodando. `checar-admin-protegido` continua verde: essa rota não
 * mora em `src/app/admin/`, é de saúde, não de administração.
 */
export async function GET() {
  try {
    const saude = await saudeDaViagem();
    return NextResponse.json(saude);
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
