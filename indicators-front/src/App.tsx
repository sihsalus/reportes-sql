import { Routes, Route } from 'react-router-dom';
import IndicadoresPage from '@/pages/IndicadoresPage';
import IndicadorDetailPage from '@/pages/IndicadorDetailPage';
import IndicadorFormPage from '@/pages/IndicadorFormPage';
import ResultadosPage from '@/pages/ResultadosPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<IndicadoresPage />} />
      <Route path="/indicadores/nuevo" element={<IndicadorFormPage mode="create" />} />
      <Route path="/indicadores/:id/editar" element={<IndicadorFormPage mode="edit" />} />
      <Route path="/indicadores/:id" element={<IndicadorDetailPage />} />
      <Route path="/resultados" element={<ResultadosPage />} />
      <Route path="*" element={<div className="p-8 text-center text-gray-600">404 — Página no encontrada</div>} />
    </Routes>
  );
}

export default App;
