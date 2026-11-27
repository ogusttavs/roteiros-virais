import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CabecaDoCartao, CartaoDeConta, TelaDeConta } from "@/app/cadastro/pecas";
import styles from "@/app/cadastro/pecas.module.css";
import { config } from "@/lib/config";
import { destinoDaSessao } from "@/lib/destino-sem-marca";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { conviteValido } from "@/servicos/convite-de-grupo";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";
import { TAMANHO_DA_PREVIA, textosPreviaDeLink } from "@/textos/previa-de-link";

import { FormularioDoConvite } from "./FormularioDoConvite";

/**
 * A prévia do link do convite no WhatsApp (27/11/2026): título, descrição e imagem próprios, iguais para todo código (a prévia não diz se o link vale, nem de quem é).
 * O `metadataBase` e o resto vêm do layout.
 */
export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }): Promise<Metadata> {
  const { codigo } = await params;
  const p = textosPreviaDeLink.convite;
  return {
    title: p.titulo,
    description: p.descricao,
    openGraph: {
      type: "website",
      siteName: config.appName,
      locale: "pt_BR",
      url: `/convite/${encodeURIComponent(codigo)}`,
      title: p.titulo,
      description: p.descricao,
      images: [{ url: p.imagem, ...TAMANHO_DA_PREVIA, alt: p.textoDaImagem }],
    },
    twitter: { card: "summary_large_image", title: p.titulo, description: p.descricao, images: [p.imagem] },
    robots: { index: false, follow: false },
  };
}

/**
 * A página do link de convite de grupo. Pública (`middleware.ts`). Link que não vale (inexistente, usado, vencido ou desativado) mostra a mesma frase, sem formulário e sem dizer o motivo.
 * Quem já está com sessão vai ao painel, como em `/entrar`.
 */
export default async function ConviteDeGrupo({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const sessao = await sessaoAtual();
  if (sessao) redirect(destinoDaSessao(sessao.user.role, Boolean(await clienteAtivoDoUsuario(sessao.user.id))));

  const t = textosConviteDeGrupo;
  if (!(await conviteValido(codigo)).valido) {
    return (
      <TelaDeConta>
        <CartaoDeConta>
          <CabecaDoCartao titulo={t.linkInvalido.titulo} subtitulo={t.linkInvalido.subtitulo} />
          <Link href="/entrar" className={styles.linkAcao}>
            {t.linkInvalido.entrar}
          </Link>
        </CartaoDeConta>
      </TelaDeConta>
    );
  }
  return <FormularioDoConvite codigo={codigo} textos={{ pagina: t.pagina, erros: t.erros, vazios: t.vazios, empresaInvalida: t.empresaInvalida }} />;
}
