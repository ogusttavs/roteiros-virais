"use client";

import type { Plataforma } from "@/db/schema";
import { limparCampoPerfil, perfilPareceValido } from "@/lib/perfil-redes";

import { Campo } from "./Campo";

/**
 * V12c, item 3b, a E37b: o começo do endereço é fixo e sem edição
 * (`Campo.prefixo`, já entregue pelo design v2); a pessoa escreve só o
 * nome do perfil, ou cola o endereço inteiro, com arroba ou sem.
 */
const PREFIXO: Record<Plataforma, string> = {
  instagram: "instagram.com/",
  tiktok: "tiktok.com/@",
  youtube: "youtube.com/@",
};

type Props = {
  plataforma: Plataforma;
  rotulo: string;
  /** Valor já normalizado (o que `limparCampoPerfil`/`normalizarHandle` devolvem; com "@" no YouTube, sem nos outros). */
  valor: string;
  onMudar: (valorNormalizado: string) => void;
  /** "Confira o nome do perfil", da tela que chama (textos/briefing.ts ou textos/conta.ts). */
  avisoInvalido: string;
  /** V12c, item 7: `ListaPerfisCitados` salva o rascunho ao sair do campo. */
  onSair?: () => void;
};

export function CampoPerfilRede({ plataforma, rotulo, valor, onMudar, avisoInvalido, onSair }: Props) {
  // O prefixo já mostra o "@" do YouTube; o campo nunca repete.
  const semArroba = valor.replace(/^@/, "");
  return (
    <Campo
      rotulo={rotulo}
      prefixo={PREFIXO[plataforma]}
      value={semArroba}
      onChange={(evento) => onMudar(limparCampoPerfil(evento.target.value, plataforma))}
      onBlur={onSair}
      erro={!perfilPareceValido(semArroba) ? avisoInvalido : undefined}
    />
  );
}
