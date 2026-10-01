import { redirect } from "next/navigation";

import { classificarMultiplo, formatarMultiplo, formatarViewsCompacto, diasDesde, fraseDiasAtras, rotuloMultiploConta } from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { evidenciaResumoPorIds, setorAindaLendo, type EvidenciaResumo } from "@/servicos/pesquisa";
import { temasParaCliente, type ResultadoTemasHoje } from "@/servicos/temas";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { avisoSemTema } from "./aviso-sem-tema";
import { TemasTela } from "./TemasTela";

function paraEvidenciaTema(resumo: EvidenciaResumo | null): EvidenciaTema | null {
  if (!resumo) return null;
  const faixa = classificarMultiplo(resumo.multiplicador);
  return {
    conta: resumo.contaNome ?? resumo.contaHandle,
    multiplo: formatarMultiplo(resumo.multiplicador),
    rotulo: rotuloMultiploConta(faixa, resumo.contaMedianaOrigem),
    views: formatarViewsCompacto(resumo.views),
    quando: resumo.publicadoEm ? fraseDiasAtras(diasDesde(resumo.publicadoEm)) : fraseDiasAtras(0),
    parecidos: resumo.quantidadeParecidos,
  };
}

/**
 * `/criar/temas` (E39a, a porta "Os temas de hoje"; migrado da antiga porta Reels de `/hoje`, que
 * virou agenda). H3, item 1: a tela sempre abre, com ou sem tema, com ou sem falha na busca;
 * `avisoSemTema` substitui os cartões quando não há tema de verdade.
 */
export default async function Temas() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const resultado = await temasParaCliente(cliente).catch((): ResultadoTemasHoje | { status: "erro" } => ({
    status: "erro",
  }));

  const temas = resultado.status === "ok" ? resultado.temas : [];
  const evidenciasTemas = await Promise.all(
    temas.map((tema) => evidenciaResumoPorIds(tema.evidencias).then(paraEvidenciaTema)),
  );
  const aindaLendo =
    resultado.status === "sem_tema" && cliente.nichoId ? await setorAindaLendo(cliente.nichoId) : false;
  const aviso = avisoSemTema(resultado, new Date(), aindaLendo);

  return (
    <TemasTela
      temas={temas}
      evidenciasTemas={evidenciasTemas}
      avisoLinhaEditorial={resultado.status === "ok" ? resultado.avisoLinhaEditorial : null}
      aviso={aviso}
      redePrincipal={cliente.redePrincipal}
    />
  );
}
