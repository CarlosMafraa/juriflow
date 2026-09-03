import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'start' | 'end' | 'center';
}

/**
 * Tabela responsiva e presentacional. Desktop: tabela com rolagem horizontal.
 * Mobile (< 768px): cada linha vira um cartão com rótulo por campo.
 */
@Component({
  selector: 'jf-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-wrap" role="region" [attr.aria-label]="caption || null" tabindex="0">
      <table class="table">
        @if (caption) {
          <caption class="table__caption">
            {{
              caption
            }}
          </caption>
        }
        <thead>
          <tr>
            @for (col of columns; track col.key) {
              <th scope="col" [style.text-align]="col.align || 'start'">{{ col.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows; track $index) {
            <tr>
              @for (col of columns; track col.key) {
                <td [attr.data-label]="col.label" [style.text-align]="col.align || 'start'">
                  {{ display(row[col.key]) }}
                </td>
              }
            </tr>
          } @empty {
            <tr>
              <td class="table__empty" [attr.colspan]="columns.length">{{ emptyText }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--jf-border, #e2e8f0);
        border-radius: var(--jf-radius-lg, 12px);
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      .table__caption {
        text-align: start;
        padding: 0.75rem 1rem;
        font-weight: 700;
      }
      th,
      td {
        padding: 0.7rem 1rem;
        border-bottom: 1px solid var(--jf-border, #e2e8f0);
      }
      th {
        background: var(--jf-surface-muted, #f8fafc);
        font-weight: 600;
        white-space: nowrap;
      }
      .table__empty {
        text-align: center;
        color: var(--jf-text-muted, #64748b);
        padding: 1.5rem;
      }
      @media (max-width: 767px) {
        .table thead {
          display: none;
        }
        .table,
        .table tbody,
        .table tr,
        .table td {
          display: block;
          width: 100%;
        }
        .table tr {
          border-bottom: 2px solid var(--jf-border, #e2e8f0);
          padding: 0.5rem 0;
        }
        .table td {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          border: 0;
          padding: 0.4rem 1rem;
          text-align: end;
        }
        .table td::before {
          content: attr(data-label);
          font-weight: 600;
          color: var(--jf-text-muted, #64748b);
          text-align: start;
        }
      }
    `,
  ],
})
export class TableComponent {
  @Input() columns: TableColumn[] = [];
  @Input() rows: Record<string, unknown>[] = [];
  @Input() caption = '';
  @Input() emptyText = 'Nenhum registro.';

  protected display(value: unknown): string {
    if (value == null) return '—';
    if (value instanceof Date) return value.toLocaleString('pt-BR');
    return String(value);
  }
}
