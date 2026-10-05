import Link from "next/link";

import { CAMBIO_DATA_TEXTO, CAMBIO_USD_BRL, CUSTO_FIXO_MENSAL_BRL, usdParaBrl } from "@/config/dinheiro";
import { DATA_PRECO_APIFY } from "@/config/precos-ia";
import { exigirAdmin } from "@/lib/sessao";
import { custosDoAdmin } from "@/servicos/admin-custos";
import { dolares, reais } from "@/textos/admin-contas";
import { textosCustosAdmin as t } from "@/textos/admin-custos";

import comum from "../comum.module.css";

import proprio from "./custos.module.css";
import { FixosAdmin, type FixoNaTela } from "./FixosAdmin";
import { TetoAdmin } from "./TetoAdmin";

const styles = { ...comum, ...proprio };

function Barra({ pct, atencao }: { pct: number; atencao?: boolean }) {
  return (
    <span className={styles.barraMeta}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: atencao ? "var(--cor-atencao)" : undefined }} />
    </span>
  );
}

/** `/admin/custos`: o que o sistema gasta, em reais com o dólar ao lado (E46 PR 3, `AdminCustos.dc.html`). */
export default async function CustosDoAdmin() {
  await exigirAdmin();
  const c = await custosDoAdmin();
  const hojeBrl = usdParaBrl(c.hoje.usd);
  const pctTeto = c.tetoBrl > 0 ? (hojeBrl / c.tetoBrl) * 100 : 0;
  const variaMes = usdParaBrl(c.ultimos30Usd + c.foraDaIA.totalUsd);
  const totalMes = variaMes + c.fixos.totalPorMesBrl;
  const maiorConta = c.porConta[0]?.usd ?? 0;
  const fixos: FixoNaTela[] = c.fixos.lista.map((f) => ({
    id: f.id,
    nome: f.nome,
    valor: Number(f.valor),
    moeda: f.moeda,
    periodo: f.periodo,
    cobra: f.cobra,
    valorTexto: `${f.moeda === "usd" ? "US$ " : "R$ "}${Number(f.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ${f.periodo === "anual" ? "por ano" : "por mês"}`,
    porMesTexto: reais(f.porMesBrl),
  }));
  const maiorTarefa = c.porOndeVai[0]?.usd ?? 0;
  const maiorRamo = c.porRamo[0]?.usd ?? 0;
  const maiorFora = c.foraDaIA.linhas[0]?.usd ?? 0;
  const [anoApify, mesApify, diaApify] = DATA_PRECO_APIFY.split("-");

  return (
    <div className={styles.pagina}>
      <div className={styles.topo}>
        <div className={styles.titulos}>
          <h1>{t.titulo}</h1>
          <span className={styles.linhaDoDia}>{t.linha(CAMBIO_USD_BRL.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), CAMBIO_DATA_TEXTO)}</span>
        </div>
      </div>

      {c.semDado ? (
        <section className={styles.cartao} data-bloco="sem-dado">
          <h2>{t.semDado.titulo}</h2>
          <p className={styles.semDado}>{t.semDado.texto}</p>
        </section>
      ) : null}

      <div className={styles.contadores} data-bloco="contadores">
        <div className={[styles.contador, c.hoje.passouDoTeto ? styles.contadorAtencao : ""].filter(Boolean).join(" ")} data-contador="hoje">
          <span className={styles.valor}>{reais(hojeBrl)}</span>
          <span className={styles.doQue}>
            {dolares(c.hoje.usd)}, {c.hoje.passouDoTeto ? t.contadores.hojePassou : t.contadores.hoje}
          </span>
        </div>
        <div className={styles.contador} data-contador="7dias">
          <span className={styles.valor}>{reais(usdParaBrl(c.ultimos7Usd))}</span>
          <span className={styles.doQue}>
            {dolares(c.ultimos7Usd)}, {t.contadores.dias7}, {t.contadores.soVaria}
          </span>
        </div>
        <div className={styles.contador} data-contador="30dias">
          <span className={styles.valor}>{reais(totalMes)}</span>
          <span className={styles.doQue}>
            {t.contadores.dias30}; {t.contadores.doQueVaria(reais(variaMes))}{c.foraDaIA.linhas.some((l) => l.algumEstimado) ? `, ${t.contadores.incluiEstimado}` : ""}
          </span>
        </div>
        <div className={styles.contador} data-contador="por-roteiro">
          <span className={styles.valor}>{c.porRoteiroUsd === null ? "-" : reais(usdParaBrl(c.porRoteiroUsd))}</span>
          <span className={styles.doQue}>
            {t.contadores.porRoteiro}, {c.roteiros30 > 0 ? t.contadores.roteiros30(c.roteiros30) : t.contadores.semRoteiro}
          </span>
        </div>
      </div>

      <section className={styles.cartao} aria-labelledby="t-teto" data-bloco="teto">
        <div className={styles.tabelaTitulo}>
          <h2 id="t-teto">{t.teto.titulo}</h2>
          <span className={styles.quantos}>{t.teto.soVaria}</span>
          <span className={styles.verTodos}>
            <TetoAdmin tetoBrl={c.tetoBrl} />
          </span>
        </div>
        <p className={styles.linhaTeto} data-teto-linha>
          {t.teto.linha(reais(hojeBrl), reais(c.tetoBrl), Math.round(pctTeto))}
        </p>
        <Barra pct={pctTeto} atencao={c.hoje.passouDoTeto} />
        {c.hoje.passouDoTeto ? (
          <div className={styles.avisoTeto} data-passou-do-teto>
            <p>{t.teto.passou(reais(hojeBrl), reais(c.tetoBrl))}</p>
            {c.hoje.maisGastou ? <p>{t.teto.maisGastou(c.hoje.maisGastou.rotulo, reais(usdParaBrl(c.hoje.maisGastou.usd)), c.hoje.maisGastou.vezes)}</p> : null}
            <Link className={styles.botaoVazio} href="/admin/jobs">
              {t.teto.verRotinas}
            </Link>
          </div>
        ) : null}
        <p className={styles.nota}>{t.teto.nota}</p>
      </section>

      <div className={styles.duas}>
        <section className={styles.cartao} aria-labelledby="t-conta" data-bloco="por-conta">
          <div className={styles.tabelaTitulo}>
            <h2 id="t-conta">{t.porConta.titulo}</h2>
            <span className={styles.quantos}>{t.porConta.legenda}</span>
          </div>
          {c.porConta.length === 0 ? (
            <p className={styles.semDado}>{t.porConta.vazio}</p>
          ) : (
            <ul className={styles.lista}>
              {c.porConta.map((conta) => (
                <li key={conta.clienteId} className={styles.itemCusto} data-conta={conta.clienteId}>
                  <span className={styles.nomeCusto}>
                    <Link href={`/admin/clientes/${conta.clienteId}`}>{conta.nome}</Link>
                    <span className={styles.detalheCusto}>{conta.roteiros > 0 ? t.porConta.roteirosCada(conta.roteiros, reais(usdParaBrl(conta.usd / conta.roteiros))) : t.porConta.semRoteiro}</span>
                  </span>
                  <span className={styles.valorCusto}>
                    {reais(usdParaBrl(conta.usd))}
                    <span className={styles.detalheCusto}>{dolares(conta.usd)}</span>
                  </span>
                  <Barra pct={maiorConta > 0 ? (conta.usd / maiorConta) * 100 : 0} />
                </li>
              ))}
            </ul>
          )}
          {c.baseDosRamosUsd > 0 ? <p className={styles.nota}>{t.porConta.base(reais(usdParaBrl(c.baseDosRamosUsd)))}</p> : null}
          <p className={styles.nota}>{t.porConta.porRamoNota}</p>
        </section>

        <section className={styles.cartao} aria-labelledby="t-onde" data-bloco="onde-vai">
          <div className={styles.tabelaTitulo}>
            <h2 id="t-onde">{t.ondeVai.titulo}</h2>
            <span className={styles.quantos}>{t.ondeVai.legenda}</span>
          </div>
          {c.porOndeVai.length === 0 ? (
            <p className={styles.semDado}>{t.ondeVai.vazio}</p>
          ) : (
            <ul className={styles.lista}>
              {c.porOndeVai.map((l) => (
                <li key={l.rotulo} className={styles.itemCusto} data-tarefa={l.chave}>
                  <span className={styles.nomeCusto}>
                    {l.rotulo}
                    <span className={styles.detalheCusto}>{t.ondeVai.vezes(l.vezes)}</span>
                  </span>
                  <span className={styles.valorCusto}>
                    {reais(usdParaBrl(l.usd))}
                    <span className={styles.detalheCusto}>{dolares(l.usd)}</span>
                  </span>
                  <Barra pct={maiorTarefa > 0 ? (l.usd / maiorTarefa) * 100 : 0} />
                </li>
              ))}
            </ul>
          )}
          <p className={styles.nota}>{t.ondeVai.semRegistro}</p>
        </section>
      </div>

      <div className={styles.duas}>
        <section className={styles.cartao} aria-labelledby="t-ramo" data-bloco="por-ramo">
          <div className={styles.tabelaTitulo}>
            <h2 id="t-ramo">{t.porRamo.titulo}</h2>
            <span className={styles.quantos}>{t.porRamo.legenda}</span>
          </div>
          {c.porRamo.length === 0 ? (
            <p className={styles.semDado}>{t.porRamo.vazio}</p>
          ) : (
            <ul className={styles.lista}>
              {c.porRamo.map((ramo) => (
                <li key={ramo.nichoId} className={styles.itemCusto} data-ramo={ramo.nichoId}>
                  <span className={styles.nomeCusto}>
                    {ramo.nome}
                    <span className={styles.detalheCusto}>{t.porRamo.detalhe(reais(usdParaBrl(ramo.iaUsd)), reais(usdParaBrl(ramo.foraUsd)))}{ramo.foraUsd > 0 ? `, ${t.porRamo.incluiEstimado}` : ""}</span>
                  </span>
                  <span className={styles.valorCusto}>
                    {reais(usdParaBrl(ramo.usd))}
                    <span className={styles.detalheCusto}>{dolares(ramo.usd)}</span>
                  </span>
                  <Barra pct={maiorRamo > 0 ? (ramo.usd / maiorRamo) * 100 : 0} />
                </li>
              ))}
            </ul>
          )}
          {c.semRamoUsd > 0 ? <p className={styles.nota}>{t.porRamo.semRamo(reais(usdParaBrl(c.semRamoUsd)))}</p> : null}
        </section>

        <section className={styles.cartao} aria-labelledby="t-fora" data-bloco="fora-da-ia">
          <div className={styles.tabelaTitulo}>
            <h2 id="t-fora">{t.foraDaIA.titulo}</h2>
            <span className={styles.quantos}>{t.foraDaIA.legenda}</span>
          </div>
          {c.foraDaIA.linhas.length === 0 ? (
            <p className={styles.semDado}>{t.foraDaIA.vazio}</p>
          ) : (
            <ul className={styles.lista}>
              {c.foraDaIA.linhas.map((l) => (
                <li key={l.fonte} className={styles.itemCusto} data-fonte={l.fonte}>
                  <span className={styles.nomeCusto}>
                    {l.rotulo}
                    <span className={styles.detalheCusto}>
                      {l.unidade === "minutos" ? t.foraDaIA.minutos(l.unidades) : t.foraDaIA.resultados(l.unidades)}, {t.foraDaIA.vezes(l.execucoes)}, {l.algumEstimado ? t.foraDaIA.estimado : t.foraDaIA.daApi}
                    </span>
                  </span>
                  <span className={styles.valorCusto}>
                    {reais(usdParaBrl(l.usd))}
                    <span className={styles.detalheCusto}>{dolares(l.usd)}</span>
                  </span>
                  <Barra pct={maiorFora > 0 ? (l.usd / maiorFora) * 100 : 0} />
                </li>
              ))}
            </ul>
          )}
          <p className={styles.nota}>{t.foraDaIA.nota(`${diaApify}/${mesApify}/${anoApify}`)}</p>
        </section>
      </div>

      <section className={styles.cartao} aria-labelledby="t-fixos" data-bloco="fixos">
        <div className={styles.tabelaTitulo}>
          <h2 id="t-fixos">{t.fixos.titulo}</h2>
          <span className={styles.quantos}>{t.fixos.legenda}</span>
        </div>
        <FixosAdmin fixos={fixos} totalTexto={reais(c.fixos.totalPorMesBrl)} padraoTexto={reais(CUSTO_FIXO_MENSAL_BRL)} />
      </section>
    </div>
  );
}
