/**
 * `/api/momento/transcrever` (P2, item 1): a rota de verdade virou `/api/transcrever` (deixou de
 * ser "do momento", já que a folha "Planejar os próximos dias" e o briefing por áudio usam a mesma
 * gravação). Este arquivo só reexporta o mesmo `POST`, para um cliente antigo em cache (o app
 * instalado na tela de início, H3) continuar funcionando sem precisar atualizar primeiro.
 */
export { POST } from "../../transcrever/route";
