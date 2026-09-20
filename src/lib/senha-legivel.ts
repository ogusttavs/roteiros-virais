/**
 * Senha inicial legivel (V3, item 5, AdminCliente.dc.html, "Convite mandado":
 * "[exemplo] vento-leve-17-janela"): substantivo, adjetivo, numero de dois
 * digitos, substantivo, separados por hifen. Facil de ler e digitar uma vez,
 * a pessoa troca depois se quiser (nao existe tela de trocar senha ainda,
 * registrado em TODO.md).
 */
import { randomInt } from "node:crypto";

const SUBSTANTIVOS = [
  "vento",
  "rio",
  "sol",
  "lua",
  "mar",
  "monte",
  "campo",
  "ceu",
  "vale",
  "porto",
  "farol",
  "jardim",
  "pomar",
  "poço",
  "trilho",
  "pilar",
];

const ADJETIVOS = [
  "leve",
  "calmo",
  "claro",
  "firme",
  "novo",
  "rapido",
  "largo",
  "fundo",
  "fresco",
  "sereno",
  "dourado",
  "quieto",
];

const SUBSTANTIVOS_FINAIS = [
  "janela",
  "estrada",
  "ponte",
  "praca",
  "esquina",
  "varanda",
  "coluna",
  "escada",
  "vidraca",
  "cerca",
  "trilha",
  "figueira",
];

function escolher(lista: string[]): string {
  return lista[randomInt(lista.length)];
}

export function gerarSenhaLegivel(): string {
  const numero = randomInt(10, 100);
  return `${escolher(SUBSTANTIVOS)}-${escolher(ADJETIVOS)}-${numero}-${escolher(SUBSTANTIVOS_FINAIS)}`;
}
