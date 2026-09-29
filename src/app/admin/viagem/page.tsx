import { Compass } from "lucide-react";
import Link from "next/link";

import { exigirAdmin } from "@/lib/sessao";
import {
  acompanhamentoDaViagem,
  marcasAtivas,
  resumoQuebradoAgora,
  type EstadoAgregado,
  type LinhaAcompanhamentoDia,
} from "@/servicos/admin-acompanhamento";
import { textosAdmin } from "@/textos/admin";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { FiltroViagem } from "./FiltroViagem";
import styles from "./page.module.css";

const t = textosAdmin.viagem;

const ROTULO_ESTADO: Record<EstadoAgregado, string> = {
  ok: t.estadoOk,
  erro: t.estadoErro,
  rodando: t.estadoRodando,
  sem_execucao: t.estadoSemExecucao,
};

/** "Pior estado vence", mesmo raciocínio do serviço, para o ponto colorido resumir coleta + transcrição numa cor só. */
const PESO_ESTADO: Record<EstadoAgregado, number> = { sem_execucao: 0, ok: 1, rodando: 2, erro: 3 };

function piorEstado(a: EstadoAgregado, b: EstadoAgregado): EstadoAgregado {
  return PESO_ESTADO[a] >= PESO_ESTADO[b] ? a : b;
}

function formatarDia(dia: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    new Date(`${dia}T12:00:00-03:00`),
  );
}

function formatarUltimoAcesso(data: Date | null): string {
  if (!data) return t.ultimoAcessoNunca;
  return t.ultimoAcesso(
    new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(data),
  );
}

function detalheCelula(linha: LinhaAcompanhamentoDia): string {
  return [
    t.detalheColeta(ROTULO_ESTADO[linha.coleta.estado], linha.coleta.novos),
    t.detalheTranscricao(ROTULO_ESTADO[linha.transcrever.estado], linha.transcrever.transcritos),
    t.detalheTemas(linha.temas),
    t.detalheRoteiros(
      linha.roteiros.total,
      linha.roteiros.porOrigem.sugerido,
      linha.roteiros.porOrigem.livre,
      linha.roteiros.porOrigem.momento,
      linha.roteiros.porFormato.reels,
      linha.roteiros.porFormato.story,
    ),
    t.detalheGravadoPostado(linha.roteiros.gravados, linha.roteiros.postados),
    t.detalheCurva(linha.curva.medidas),
    t.detalhePlano(linha.plano.sugerido, linha.plano.aceito, linha.plano.gravado, linha.plano.pulado),
  ].join("\n");
}

type SearchParams = { periodo?: string; marcaId?: string };

/**
 * `/admin/viagem` (V10, item 1 e 2): dia a dia por marca, mais o topo "o
 * que está quebrado agora". Cada célula mostra um ponto colorido (o pior
 * estado entre coleta e transcrição naquele dia) e a contagem de roteiros;
 * o resto do detalhe (temas, curva, plano, gravado/postado) abre num toque
 * (V12, item 7: o `title` nativo não abre no celular). `<details>` nativo,
 * sem tooltip novo desenhado (regra 11).
 */
export default async function AdminViagem({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await exigirAdmin();

  const params = await searchParams;
  const periodo = params.periodo === "14" ? 14 : params.periodo === "30" ? 30 : 7;
  const marcaId = params.marcaId ? Number(params.marcaId) : undefined;

  const [todasMarcas, marcas, resumo] = await Promise.all([
    marcasAtivas(),
    acompanhamentoDaViagem(periodo, marcaId),
    resumoQuebradoAgora(),
  ]);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo}</p>
        </div>
      </div>

      <section className={styles.resumo}>
        <h2>{t.quebradoAgoraTitulo}</h2>
        <div className={styles.cartoes}>
          <div className={styles.cartao}>
            <span className={styles.cartaoRotulo}>{t.ultimoErroJobRotulo}</span>
            <span className={styles.cartaoValor}>
              {resumo.ultimoErroJob ? `${resumo.ultimoErroJob.nome}: ${resumo.ultimoErroJob.mensagem}` : t.ultimoErroJobVazio}
            </span>
          </div>
          <div className={styles.cartao}>
            <span className={styles.cartaoRotulo}>{t.consumoRotulo}</span>
            <span className={styles.cartaoValor}>
              {resumo.consumo.map((c) => (
                <span key={c.fonte} className={styles.linhaConsumo}>
                  {c.fonte}: {c.unidades}
                  {c.teto !== null ? ` / ${c.teto}` : ` (${t.consumoSemTeto})`} {c.unidade === "hora" ? t.consumoPorHora : t.consumoPorDia}
                </span>
              ))}
            </span>
          </div>
          <div className={styles.cartao}>
            <span className={styles.cartaoRotulo}>{t.geracaoReprovadaRotulo}</span>
            <span className={styles.cartaoValor}>
              {resumo.geracaoReprovadaDuasVezes
                ? t.geracaoReprovadaComMotivo(resumo.geracaoReprovadaDuasVezes.tarefa, resumo.geracaoReprovadaDuasVezes.motivo)
                : t.geracaoReprovadaVazio}
            </span>
          </div>
        </div>
      </section>

      <div className={styles.linhaFiltros}>
        <nav aria-label="período" className={chipStyles.grupo}>
          {([7, 14, 30] as const).map((opcao) => {
            const proximosParams = new URLSearchParams();
            if (marcaId) proximosParams.set("marcaId", String(marcaId));
            proximosParams.set("periodo", String(opcao));
            const ativo = periodo === opcao;
            return (
              <Link
                key={opcao}
                href={`/admin/viagem?${proximosParams.toString()}`}
                aria-current={ativo ? "true" : undefined}
                className={[chipStyles.chip, ativo ? chipStyles.ativo : ""].filter(Boolean).join(" ")}
              >
                {opcao === 7 ? t.periodo7 : opcao === 14 ? t.periodo14 : t.periodo30}
              </Link>
            );
          })}
        </nav>
        <FiltroViagem marcas={todasMarcas} />
      </div>

      {marcas.length === 0 ? (
        <EstadoVazio icone={<Compass size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.semMarcaAtiva} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaDia}</th>
                {marcas.map((marca) => (
                  <th key={marca.id}>
                    <div className={styles.cabecalhoMarca}>
                      <span>{marca.nome}</span>
                      <span className={styles.ultimoAcesso}>{formatarUltimoAcesso(marca.ultimoAcessoEm)}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {marcas[0].linhas.map((linhaBase, indiceDia) => (
                <tr key={linhaBase.dia}>
                  <td className={styles.mono}>{formatarDia(linhaBase.dia)}</td>
                  {marcas.map((marca) => {
                    const linha = marca.linhas[indiceDia];
                    const estado = piorEstado(linha.coleta.estado, linha.transcrever.estado);
                    return (
                      <td key={marca.id}>
                        <details className={styles.celulaDetalhe}>
                          <summary>
                            <span className={styles.ponto} data-estado={estado} aria-hidden="true" />
                            {t.roteirosRotulo(linha.roteiros.total)}
                          </summary>
                          <pre className={styles.celulaDetalhePre}>{detalheCelula(linha)}</pre>
                        </details>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
