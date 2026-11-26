/**
 * Senha inicial do convite (provisoria, E58: no primeiro acesso o painel pede a troca por uma que a pessoa escolhe, `servicos/senha.ts`, `/trocar-senha`).
 *
 * T100 (auditoria de seguranca de 26/11/2026, achado A3): a versao anterior sorteava entre listas de palavras do repositorio publico (cerca de 207 mil combinacoes, 17,7 bits), pouco para
 * quem sabe o e-mail da pessoa. Agora sao 13 caracteres sorteados com `crypto.randomInt` de um alfabeto de 31 simbolos, 64 bits de acaso, em tres grupos
 * separados por hifen ("k7mq-x4tn-p9hrc"), faceis de ditar e de digitar no celular: so minusculas e digitos, sem as letras e os numeros que se confundem
 * (0, o, 1, l, i) e sem acento.
 */
import { randomInt } from "node:crypto";

export const ALFABETO_SENHA = "abcdefghjkmnpqrstuvwxyz23456789";
export const GRUPOS_SENHA = [4, 4, 5];

export function gerarSenhaLegivel(): string {
  return GRUPOS_SENHA.map((tamanho) =>
    Array.from({ length: tamanho }, () => ALFABETO_SENHA[randomInt(ALFABETO_SENHA.length)]).join(""),
  ).join("-");
}
