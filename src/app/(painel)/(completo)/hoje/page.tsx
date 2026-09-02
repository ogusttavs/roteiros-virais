import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Hoje() {
  return <EstadoVazio titulo={textosVazio.hoje.titulo} descricao={textosVazio.hoje.descricao} />;
}
