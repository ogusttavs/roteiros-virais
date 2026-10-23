import { redirect } from "next/navigation";

import { sessaoDoPainel } from "@/lib/ver-como";
import { assinaturasDaMarca, ehDonoDaMarca } from "@/servicos/assinatura";
import { situacaoDaAssinatura } from "@/servicos/assinatura-tela";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosAssinatura } from "@/textos/assinatura";
import { Cartao } from "@/ui/componentes/Cartao";

import { BotoesDaAssinatura } from "./BotoesDaAssinatura";
import { ConfirmandoPagamento } from "./ConfirmandoPagamento";
import styles from "./page.module.css";
import { botaoEhDoDono, botoesDaTela, textosDaTela, visaoDaTela } from "./visao";

/**
 * `/assinar` (E22 PR 2): onde cai a marca sem assinatura que vale e sem cortesia quando o portão está ligado, e onde a pessoa vê o estado da assinatura (confirmada, ativa, cartão a
 * atualizar). Fora do grupo `(completo)` de propósito: o portão redireciona para cá, e o layout dele não pode barrar a própria tela de pagar. Só as peças e os tokens que o painel
 * já tem (Cartao, Botao); nenhum desenho novo. O que decide cada tela está em `visao.ts` (puro, com teste).
 */
export default async function Assinar({ searchParams }: { searchParams: Promise<{ assinou?: string }> }) {
  const { assinou } = await searchParams;
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect("/comecar");

  const lista = await assinaturasDaMarca(cliente.id);
  const situacao = situacaoDaAssinatura(cliente.cortesia, lista);
  const visao = visaoDaTela(situacao, assinou === "1");
  const verComo = sessao.verComo !== null;
  const dono = verComo ? false : await ehDonoDaMarca(sessao.user.id, cliente.id);

  const todos = botoesDaTela(visao);
  // Quem não é o dono (e o "ver como") não vê o que mexe em dinheiro; o "Ir para o Hoje" continua para quem tem acesso.
  const botoes = todos.filter((b) => !botaoEhDoDono(b) || dono);
  const faltaPermissao = todos.some(botaoEhDoDono) && !dono;
  const { titulo, frases } = textosDaTela(visao, situacao);
  const convite = visao === "pitch" || visao === "encerrada";
  const aviso = verComo ? textosAssinatura.verComo : faltaPermissao ? textosAssinatura.semPermissao : null;

  return (
    <div className={styles.pagina} data-assinatura={visao}>
      <header className={styles.cabeca}>
        <span className={styles.rotulo}>{textosAssinatura.plano.rotulo}</span>
        <h1>{titulo}</h1>
        {frases.map((f) => (
          <p key={f} className={styles.frase}>
            {f}
          </p>
        ))}
      </header>

      {convite ? (
        <Cartao variante="destaque" className={styles.plano}>
          <div className={styles.preco}>
            <span className={styles.valor}>{textosAssinatura.plano.preco}</span>
            <span className={styles.porMes}>{textosAssinatura.plano.porMes}</span>
          </div>
          <p className={styles.total}>
            {textosAssinatura.plano.total} {textosAssinatura.plano.semTaxa}
          </p>
          <div className={styles.inclui}>
            <h2 className={styles.incluiTitulo}>{textosAssinatura.inclui.titulo}</h2>
            <ul className={styles.itens}>
              {textosAssinatura.inclui.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          {aviso ? <p className={styles.aviso}>{aviso}</p> : null}
          {botoes.length > 0 ? <BotoesDaAssinatura botoes={botoes} tamanho="lg" /> : null}
          <ul className={styles.garantias}>
            {textosAssinatura.garantias.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Cartao>
      ) : (
        <Cartao variante="destaque" className={styles.estado}>
          {situacao.status && visao !== "cortesia" && visao !== "aguardando" ? (
            <p className={styles.situacao}>
              <span className={styles.rotulo}>{textosAssinatura.conta.statusRotulo}</span>
              <span className={styles.situacaoValor}>{textosAssinatura.status[situacao.status]}</span>
            </p>
          ) : null}
          {visao === "aguardando" ? <ConfirmandoPagamento /> : null}
          {aviso && visao !== "aguardando" ? <p className={styles.aviso}>{aviso}</p> : null}
          {botoes.length > 0 ? <BotoesDaAssinatura botoes={botoes} tamanho="lg" /> : null}
        </Cartao>
      )}
    </div>
  );
}
