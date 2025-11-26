const fileinput = document.getElementById('fileinput');
const dropzone = document.getElementById('dropzone');
const meta = document.getElementById('meta');
const filelist = document.getElementById('filelist');
const preview = document.getElementById('preview');
const empty = document.getElementById('empty');
const downloadAll = document.getElementById('downloadAll');
const clearBtn = document.getElementById('clear');

let currentZipBytes = null;
let currentFiles = [];
let currentZipName = 'recon.zip';

// Open in separate window button
let openWindowBtn = document.createElement('button');
openWindowBtn.textContent = "Open in Window";
openWindowBtn.className = "btn";
openWindowBtn.style.margin = "10px 0";
const leftDiv = document.querySelector('.left');
leftDiv.insertBefore(openWindowBtn, dropzone.nextSibling);

openWindowBtn.onclick = () => {
    chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 900,
        height: 700
    });
};

// Handle file/folder drops
async function handleFile(file) {
    if (file.type === '' && file instanceof File) {
        // Folder (Chrome uses webkitRelativePath)
        const zip = new JSZip();
        await addFolderToZip(file.webkitRelativePath.split('/')[0], [file], zip);
        const ab = await zip.generateAsync({ type: 'arraybuffer' });
        currentZipName = 'folder_recon.zip';
        currentZipBytes = ab;
        meta.textContent = `${currentZipName} — ${ab.byteLength} bytes`;
        await loadZipFromArrayBuffer(ab);
    } else {
        currentZipName = file.name || 'recon.zip';
        meta.textContent = `${file.name} — ${file.size} bytes`;
        const ab = await file.arrayBuffer();
        currentZipBytes = ab;
        await loadZipFromArrayBuffer(ab);
    }
}

async function addFolderToZip(folderName, files, zip) {
    for (const file of files) {
        zip.file(file.webkitRelativePath || file.name, await file.arrayBuffer());
    }
}

// Load ZIP and list files
async function loadZipFromArrayBuffer(ab) {
    filelist.innerHTML = '';
    const zip = await JSZip.loadAsync(ab);
    const entries = [];
    zip.forEach((path, entry) => {
        if (!entry.dir) entries.push({ path, size: entry._data.uncompressedSize || 0, entry });
    });
    entries.sort((a, b) => a.path.localeCompare(b.path));
    currentFiles = entries;

    for (const [idx, f] of entries.entries()) {
        const li = document.createElement('li');
        li.className = 'fileitem';
        li.innerHTML = `<div class="fileicon">📄</div>
                        <div style="flex:1">
                            <div class="fname">${f.path}</div>
                            <div class="fsmall">${f.size} bytes</div>
                        </div>`;
        li.onclick = () => previewFileLazy(f);
        filelist.appendChild(li);
    }
}

// Lazy loading preview
async function previewFileLazy(fileObj) {
    empty.style.display = 'none';
    preview.innerHTML = '<div style="padding:8px">Loading…</div>';

    const blob = await fileObj.entry.async("blob");

    // Image preview
    if (blob.type.startsWith('image/')) {
        const url = URL.createObjectURL(blob);
        preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;border-radius:8px">`;
        return;
    }

    const txt = await blob.text();
    preview.innerHTML = '<pre class="code"></pre>';
    const pre = preview.querySelector('pre.code');

    const lines = txt.split('\n');
    const chunkSize = 1000;
    let idx = 0;

    function renderChunk() {
        const chunk = lines.slice(idx, idx + chunkSize).join('\n') + '\n';
        pre.textContent += chunk;
        idx += chunkSize;
        if (idx < lines.length) requestAnimationFrame(renderChunk);
    }
    renderChunk();
}

// Event listeners for file input & drag/drop
fileinput.addEventListener('change', async e => { const f = e.target.files[0]; if (f) await handleFile(f); });
['dragenter','dragover'].forEach(evt => { dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.style.borderColor = 'rgba(99,102,241,0.8)'; }); });
['dragleave','drop'].forEach(evt => { dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.style.borderColor = 'rgba(255,255,255,0.06)'; }); });
dropzone.addEventListener('drop', async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) await handleFile(f); });

// Download entire ZIP
downloadAll.onclick = () => {
    if(!currentZipBytes) return alert('No zip loaded');
    const blob = new Blob([currentZipBytes], { type:'application/zip'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url;
    a.download=currentZipName;
    a.click();
};

// Clear everything
clearBtn.addEventListener('click', () => {
    currentZipBytes = null;
    currentFiles = [];
    filelist.innerHTML = '';
    preview.innerHTML = '';
    empty.style.display = 'flex';
    meta.textContent = 'No file loaded';
});

let currentIndex = -1; // track currently selected file

async function loadZipFromArrayBuffer(ab) {
    filelist.innerHTML = '';
    const zip = await JSZip.loadAsync(ab);
    const entries = [];
    zip.forEach((path, entry) => {
        if (!entry.dir) entries.push({ path, size: entry._data.uncompressedSize || 0, entry });
    });
    entries.sort((a, b) => a.path.localeCompare(b.path));
    currentFiles = entries;

    for (const [idx, f] of entries.entries()) {
        const li = document.createElement('li');
        li.className = 'fileitem';
        li.innerHTML = `
            <div class="fileicon">📄</div>
            <div style="flex:1">
                <div class="fname">${f.path}</div>
                <div class="fsmall">${f.size} bytes</div>
            </div>
            <button class="btn btn-ghost shareBtn" style="font-size:10px;">Share</button>
        `;

        // Click file to preview
        li.addEventListener('click', (e) => {
            if (!e.target.classList.contains('shareBtn')) {
                previewFileLazy(f);
                currentIndex = idx;
                highlightSelectedFile(idx);
            }
        });

        // Click Share button
        li.querySelector('.shareBtn').addEventListener('click', async (e) => {
            e.stopPropagation(); // prevent preview click
            currentIndex = idx;
            const fileObj = currentFiles[currentIndex];
            const blob = await fileObj.entry.async("blob");
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // Convert to binary string
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }

            // Base64 + compress
            const b64 = btoa(binary);
            const compressed = LZString.compressToEncodedURIComponent(b64);

            const url = location.origin + location.pathname + '#file=' + encodeURIComponent(fileObj.path) + '&data=' + compressed;
            navigator.clipboard.writeText(url);
            alert(`Shareable link copied to clipboard!\n${url}`);
        });

        filelist.appendChild(li);
    }
}

// Highlight selected file in file list
function highlightSelectedFile(idx) {
    document.querySelectorAll('.fileitem').forEach((el, i) => {
        el.style.background = (i === idx) ? 'rgba(99,102,241,0.2)' : 'var(--card)';
    });
}

// On load: consume shared link
(function consumeShareLink() {
    if (!location.hash) return;
    const hash = location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const filePath = params.get('file');
    const compressedData = params.get('data');
    if (!filePath || !compressedData) return;

    try {
        const base64 = LZString.decompressFromEncodedURIComponent(compressedData);
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const file = new File([binary], filePath);
        handleFile(file);  // preview the shared file
        history.replaceState(null, '', location.pathname); // clean URL
    } catch (e) {
        console.error("Error opening shared file:", e);
    }
})();

