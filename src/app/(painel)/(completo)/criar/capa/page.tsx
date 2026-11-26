import { Newspaper } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { dataDaCapa, motivoDeNaoServirParaCapa, veiculoDaCapa } from "@/carrossel/capa-noticia";
import { carrosselAtivo } from "@/config/carrossel";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { arrobaDaMarca, carrosselDaMarca } from "@/servicos/carrossel";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { noticiaPorId } from "@/servicos/noticias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { CapaTela } from "./CapaTela";

/**
 * `/criar/capa?noticia=<id>` (E66, a capa de notícia): só existe com `CARROSSEL_ATIVO` ligada. A notícia é do setor da marca, com data de até 7 dias e veículo conhecido; outra coisa não abre
 * (a tela diz por quê). Monta a capa com as peças da tela do carrossel.
 */
export default async function CriarCapa({ searchParams }: { searchParams: Promise<{ noticia?: string; id?: string }> }) {
  if (!carrosselAtivo()) notFound();
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));
  await exigirAssinaturaValida();
  const parametros = await searchParams;
  const arroba = arrobaDaMarca(cliente.perfis?.instagram);

  // Abrir pelo endereço da capa pronta (`?id=`): a capa é da marca e é uma capa de notícia (outra coisa, ou de outra marca, não existe). Já feita, não depende mais de a notícia ter menos de 7 dias.
  if (parametros.id) {
    const capaId = idDoBancoOuNulo(parametros.id);
    const capa = capaId === null ? null : await carrosselDaMarca(cliente.id, capaId);
    const slide = capa?.slides[0];
    const noticiaDaCapa = typeof capa?.origemRef?.noticiaId === "number" ? capa.origemRef.noticiaId : null;
    if (!capa || capa.origem !== "noticia" || slide?.tipo !== "noticia" || noticiaDaCapa === null) notFound();
    return <CapaTela noticia={{ id: noticiaDaCapa, titulo: capa.tema, veiculo: slide.veiculo ?? "", data: slide.data ?? "" }} corMarca={cliente.corMarca} arroba={arroba} capaInicialId={capa.id} />;
  }

  const id = idDoBancoOuNulo(parametros.noticia ?? "");
  const noticia = id !== null && cliente.nichoId ? await noticiaPorId(id, cliente.nichoId) : null;
  if (!noticia || noticia.relevante !== true) notFound();
  const motivo = motivoDeNaoServirParaCapa(noticia);
  if (motivo || !noticia.publicadoEm) {
    return <EstadoVazio icone={<Newspaper size={24} strokeWidth={1.5} aria-hidden="true" />} frase={motivo ?? "Esta notícia não tem data, então não dá para fazer a capa."} acao={{ rotulo: "Voltar para Notícias", href: "/noticias" }} />;
  }
  return (
    <CapaTela
      noticia={{ id: noticia.id, titulo: noticia.titulo, veiculo: veiculoDaCapa(noticia.fonte), data: dataDaCapa(noticia.publicadoEm) }}
      corMarca={cliente.corMarca}
      arroba={arroba}
    />
  );
}
