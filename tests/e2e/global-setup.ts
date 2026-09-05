/**
 * Reset e semeadura do banco, uma vez so, antes de qualquer arquivo de
 * teste (globalSetup e garantido pelo Playwright rodar primeiro, diferente
 * de depender da ordem alfabetica dos arquivos de spec). Etapa 11, ajuste 3
 * da revisao da etapa 10.
 *
 * Sob carga (duas sessoes na mesma maquina), a suite completa recebeu
 * `/hoje` onde esperava `/comecar` num arquivo que resetava o schema no
 * proprio `beforeAll`, provavelmente porque o servidor de desenvolvimento
 * continuava quente entre um reset e outro; cada arquivo de spec agora cria
 * os proprios dados, com prefixo de id proprio, em vez de derrubar o schema
 * de novo. O pool do Postgres (`db()`, globalThis) e o mesmo do resto da
 * suite (achado rodando de verdade: fechar aqui derrubava o
 * `globalTeardown`, "called end on pool more than once"), entao nao fecha o
 * proprio pool aqui; quem fecha e o `globalTeardown`, como antes.
 *
 * Ate a etapa 13, parte 3, este arquivo tambem visitava um punhado de rotas
 * antes da suite comecar, para forcar a compilacao sob demanda do `next dev`
 * (achados das revisoes das etapas 7 e 8: o clique do Playwright podia
 * chegar antes de o React anexar o onSubmit do formulario ainda
 * compilando, e o navegador caia no submit nativo do <form>, vazando
 * e-mail e senha na query string). O aquecimento saiu porque a suite passou
 * a rodar contra `next start` (build de producao pronto, sem compilacao sob
 * demanda nenhuma); se a suite voltar a rodar contra `next dev`, o
 * aquecimento provavelmente volta a fazer falta.
 */
import { resetarSchema } from "../../scripts/resetar-schema";
import { semear } from "../../scripts/semear";
import { db } from "../../src/db";

export default async function globalSetup() {
  await resetarSchema(db());
  await semear(db());
}
