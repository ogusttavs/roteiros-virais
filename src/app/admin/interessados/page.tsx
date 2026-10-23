import { MessageCircle, UserPlus } from "lucide-react";

import { exigirAdmin } from "@/lib/sessao";
import { listarInteressados, whatsappPorExtenso } from "@/servicos/interessados";
import { textosInteressados } from "@/textos/interessados";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "../comum.module.css";

import { BotaoApagar } from "./BotaoApagar";

const t = textosInteressados.admin;
const LIMITE_DA_LISTA = 300;

function quando(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(d).replace(".", "");
}

/**
 * `/admin/interessados` (E57a): quem preencheu o "Quero testar" da página de entrada, do mais novo para o mais velho. Só leitura. `exigirAdmin` na primeira linha (o
 * `checar-admin-protegido` confere); os dados são de gente que ainda não é cliente, então só o admin os vê.
 */
export default async function AdminInteressados() {
  await exigirAdmin();
  const { total, linhas } = await listarInteressados(LIMITE_DA_LISTA);

  return (
    <div className={styles.pagina}>
      <div className={styles.topo}>
        <div className={styles.titulos}>
          <h1>{t.titulo}</h1>
          <span className={styles.linhaDoDia}>{t.subtitulo(total)}</span>
        </div>
      </div>

      {linhas.length === 0 ? (
        <EstadoVazio icone={<UserPlus size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <>
          <div className={styles.tabelaArea}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th scope="col">{t.colunaNome}</th>
                  <th scope="col">{t.colunaEmail}</th>
                  <th scope="col">{t.colunaWhatsapp}</th>
                  <th scope="col">{t.colunaRamo}</th>
                  <th scope="col">{t.colunaQuando}</th>
                  <th scope="col">
                    <span className={styles.somenteLeitor}>{t.colunaAcoes}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => (
                  <tr key={linha.id} data-interessado={linha.id}>
                    <td className={styles.forte}>{linha.nome}</td>
                    <td>{linha.email}</td>
                    <td>
                      <a className={styles.botaoTexto} href={`https://wa.me/55${linha.whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label={`${t.abrirWhatsapp}: ${linha.nome}`}>
                        <MessageCircle size={16} strokeWidth={1.5} aria-hidden="true" />
                        {whatsappPorExtenso(linha.whatsapp)}
                      </a>
                    </td>
                    <td>{linha.ramo}</td>
                    <td>{quando(linha.criadoEm)}</td>
                    <td>
                      <BotaoApagar
                        id={linha.id}
                        textos={{ apagar: t.apagar, confirmar: t.apagarConfirmar, cancelar: t.apagarCancelar, apagando: t.apagando, aria: t.apagarAria(linha.nome), erro: t.apagarErro }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > linhas.length ? <p className={styles.semDado}>{t.listaTruncada(linhas.length)}</p> : null}
        </>
      )}
    </div>
  );
}
