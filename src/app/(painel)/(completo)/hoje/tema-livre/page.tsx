import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";

import { TemaLivreTela } from "./TemaLivreTela";

export default async function TemaLivre() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  return <TemaLivreTela notaMinima={config.regras.notaMinimaTema} />;
}
