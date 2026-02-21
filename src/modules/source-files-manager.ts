import { getStore } from './asset-store.js';
import { formatFileSize } from './metadata-manager.js';
import { notify, escapeHtml } from './utilities.js';

export function handleSourceFilesInput(event: Event): void {
    const assets = getStore();
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    const category = (document.getElementById('source-files-category') as HTMLInputElement)?.value || '';

    for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        assets.sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false });
    }

    updateSourceFilesUI();
    notify.info(`Added ${files.length} source file(s) for archival.`);

    // Reset input so the same files can be re-added if needed
    target.value = '';
}

function removeSourceFile(index: number): void {
    const assets = getStore();
    assets.sourceFiles.splice(index, 1);
    updateSourceFilesUI();
}

export function updateSourceFilesUI(): void {
    const assets = getStore();
    const listEl = document.getElementById('source-files-list');
    const summaryEl = document.getElementById('source-files-summary');
    const countEl = document.getElementById('source-files-count');
    const sizeEl = document.getElementById('source-files-size');

    if (!listEl) return;

    listEl.innerHTML = '';

    assets.sourceFiles.forEach((sf, i) => {
        const item = document.createElement('div');
        item.className = 'source-file-item';
        const safeName = escapeHtml(sf.name);
        item.innerHTML = `<span class="source-file-name" title="${safeName}">${safeName}</span>` +
            `<span class="source-file-size">${formatFileSize(sf.size)}</span>` +
            (sf.fromArchive ? '' : `<span class="source-file-remove" data-index="${i}" title="Remove">\u00d7</span>`);
        listEl.appendChild(item);
    });

    // Wire up remove buttons
    listEl.querySelectorAll('.source-file-remove').forEach((btn: Element) => {
        btn.addEventListener('click', () => removeSourceFile(parseInt((btn as HTMLElement).dataset.index!)));
    });

    const totalSize = assets.sourceFiles.reduce((sum: number, sf: any) => sum + sf.size, 0);

    if (summaryEl) {
        summaryEl.style.display = assets.sourceFiles.length > 0 ? '' : 'none';
    }
    if (countEl) countEl.textContent = String(assets.sourceFiles.length);
    if (sizeEl) sizeEl.textContent = formatFileSize(totalSize);
}
