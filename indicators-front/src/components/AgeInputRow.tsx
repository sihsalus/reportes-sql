import type { ReactElement } from 'react';
import Input from '@/components/ui/Input';
import Label from '@/components/ui/Label';

export interface AgeInputRowProps {
  label: string;
  anios: string;
  meses: string;
  dias: string;
  onAniosChange: (value: string) => void;
  onMesesChange: (value: string) => void;
  onDiasChange: (value: string) => void;
  error?: string;
}

export default function AgeInputRow({
  label,
  anios,
  meses,
  dias,
  onAniosChange,
  onMesesChange,
  onDiasChange,
  error,
}: AgeInputRowProps): ReactElement {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col items-center">
          <Input
            type="number"
            min={0}
            value={anios}
            onChange={(e) => onAniosChange(e.target.value)}
            className="w-20 text-center"
            placeholder="0"
            aria-label={`${label} años`}
          />
          <span className="mt-1 text-xs text-gray-500">Años</span>
        </div>
        <div className="flex flex-col items-center">
          <Input
            type="number"
            min={0}
            value={meses}
            onChange={(e) => onMesesChange(e.target.value)}
            className="w-20 text-center"
            placeholder="0"
            aria-label={`${label} meses`}
          />
          <span className="mt-1 text-xs text-gray-500">Meses</span>
        </div>
        <div className="flex flex-col items-center">
          <Input
            type="number"
            min={0}
            value={dias}
            onChange={(e) => onDiasChange(e.target.value)}
            className="w-20 text-center"
            placeholder="0"
            aria-label={`${label} días`}
          />
          <span className="mt-1 text-xs text-gray-500">Días</span>
        </div>
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}
    </div>
  );
}
