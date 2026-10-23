import { BotoesDaAssinatura } from "@/app/(painel)/assinar/BotoesDaAssinatura";
import { botaoEhDoDono, cartaoDaConta } from "@/app/(painel)/assinar/visao";
import type { SituacaoDaAssinatura } from "@/servicos/assinatura-tela";
import { textosAssinatura } from "@/textos/assinatura";
import { Cartao } from "@/ui/componentes/Cartao";

import styles from "./SuaAssinatura.module.css";

type Props = { situacao: SituacaoDaAssinatura; dono: boolean; verComo: boolean };

/**
 * "Sua assinatura" em Conta (E22 PR 2): a situação (ativa, atrasada, cancelada), a data da próxima cobrança ou do fim, e o botão do portal do cliente (trocar o cartão, ver as faturas,
 * cancelar). Mesmo cartão e mesma letra de "Instalar no celular". Só o dono vê os botões que mexem em dinheiro; quem é só membro e o "ver como" leem a situação sem eles.
 * Quem chama decide se o cartão aparece (só com a cobrança ligada ou com assinatura no histórico: desligada e sem assinatura, nada muda em Conta).
 */
export function SuaAssinatura({ situacao, dono, verComo }: Props) {
  const { situacao: linha, data, botoes } = cartaoDaConta(situacao);
  const visiveis = botoes.filter((b) => !botaoEhDoDono(b) || (dono && !verComo));
  return (
    <Cartao className={styles.cartao} data-testid="sua-assinatura" data-situacao={situacao.tipo}>
      <h3 className={styles.titulo}>{textosAssinatura.conta.titulo}</h3>
      <p className={styles.situacao}>
        <span className={styles.rotulo}>{textosAssinatura.conta.statusRotulo}</span>
        <span className={styles.valor}>{linha}</span>
      </p>
      {data ? <p className={styles.data}>{data}</p> : null}
      {visiveis.length > 0 ? <BotoesDaAssinatura botoes={visiveis} /> : null}
    </Cartao>
  );
}
