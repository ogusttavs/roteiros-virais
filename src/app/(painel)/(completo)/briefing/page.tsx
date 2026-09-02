import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Briefing() {
  return (
    <EstadoVazio titulo={textosVazio.briefing.titulo} descricao={textosVazio.briefing.descricao} />
  );
}
