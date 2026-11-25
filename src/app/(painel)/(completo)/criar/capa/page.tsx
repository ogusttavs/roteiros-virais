import { Newspaper } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { dataDaCapa, motivoDeNaoServirParaCapa, veiculoDaCapa } from "@/carrossel/capa-noticia";
import { carrosselAtivo } from "@/config/carrossel";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { arrobaDaMarca, marcaEhDeSaude } from "@/servicos/carrossel";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { noticiaPorId } from "@/servicos/noticias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { CapaTela } from "./CapaTela";

/**
 * `/criar/capa?noticia=<id>` (E66, a capa de notícia): só existe com `CARROSSEL_ATIVO` ligada. A notícia é do setor da marca, com data de até 7 dias e veículo conhecido; outra coisa não abre
 * (a tela diz por quê). Monta a capa com as peças da tela do carrossel.
 */
export default async function CriarCapa({ searchParams }: { searchParams: Promise<{ noticia?: string }> }) {
  if (!carrosselAtivo()) notFound();
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));
  await exigirAssinaturaValida();
  const id = idDoBancoOuNulo((await searchParams).noticia ?? "");
  const noticia = id !== null && cliente.nichoId ? await noticiaPorId(id, cliente.nichoId) : null;
  if (!noticia || noticia.relevante !== true) notFound();
  const motivo = motivoDeNaoServirParaCapa(noticia);
  if (motivo || !noticia.publicadoEm) {
    return <EstadoVazio icone={<Newspaper size={24} strokeWidth={1.5} aria-hidden="true" />} frase={motivo ?? "Esta notícia não tem data, então não dá para fazer a capa."} acao={{ rotulo: "Voltar para Notícias", href: "/noticias" }} />;
  }
  const ramoSaude = await marcaEhDeSaude(cliente.id);
  return (
    <CapaTela
      noticia={{ id: noticia.id, titulo: noticia.titulo, veiculo: veiculoDaCapa(noticia.fonte), data: dataDaCapa(noticia.publicadoEm) }}
      corMarca={cliente.corMarca}
      arroba={arrobaDaMarca(cliente.perfis?.instagram)}
      ramoSaude={ramoSaude}
    />
  );
}
