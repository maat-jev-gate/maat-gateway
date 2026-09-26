import { useState } from "react";

const presets = [
  { name: "Agent", url: import.meta.env.VITE_AGENT_URL || "" },
  { name: "Gateway", url: import.meta.env.VITE_GATEWAY_URL || "" },
  { name: "Merchant", url: import.meta.env.VITE_MERCHANT_URL || "" },
  { name: "World Demo", url: import.meta.env.VITE_WORLD_URL || "" },
];

const initialUrls = presets.slice(0, 3).map((preset) => preset.url);
const positions = ["Left", "Center", "Right"];

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function App() {
  const [draftUrls, setDraftUrls] = useState(initialUrls);
  const [loadedUrls, setLoadedUrls] = useState(initialUrls);
  const [invalidIndex, setInvalidIndex] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function updateDraft(index: number, value: string) {
    setDraftUrls((current) => current.map((url, urlIndex) => urlIndex === index ? value : url));
    setInvalidIndex(null);
  }

  function loadUrl(index: number) {
    const url = normalizeUrl(draftUrls[index]);
    if (!url) {
      setInvalidIndex(index);
      return;
    }
    setLoadedUrls((current) => current.map((loaded, urlIndex) => urlIndex === index ? url : loaded));
    setInvalidIndex(null);
  }

  function selectPreset(index: number, url: string) {
    setDraftUrls((current) => current.map((draft, urlIndex) => urlIndex === index ? url : draft));
    setLoadedUrls((current) => current.map((loaded, urlIndex) => urlIndex === index ? url : loaded));
    setInvalidIndex(null);
    setOpenIndex(null);
  }

  return (
    <main className="views" aria-label="Maat demo">
      {positions.map((position, index) => (
        <section className="view-pane" key={position} aria-label={`${position} page`}>
          <div className="pane-controls">
            <div
              className="url-picker"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  loadUrl(index);
                  setOpenIndex(null);
                }
              }}
            >
              <input
                type="url"
                aria-label={`${position} page URL`}
                aria-invalid={invalidIndex === index}
                aria-expanded={openIndex === index}
                aria-controls={`presets-${index}`}
                value={draftUrls[index]}
                placeholder="https://example.com"
                onFocus={() => setOpenIndex(index)}
                onClick={() => setOpenIndex(index)}
                onChange={(event) => updateDraft(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    loadUrl(index);
                    setOpenIndex(null);
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setOpenIndex(null);
                    event.currentTarget.blur();
                  }
                }}
              />
              {openIndex === index && (
                <div className="preset-menu" id={`presets-${index}`} aria-label="Preset URLs">
                  {presets.filter((preset) => preset.url).map((preset) => (
                    <button type="button" key={preset.name} onClick={() => selectPreset(index, preset.url)}>
                      {preset.url}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <a href={loadedUrls[index]} target="_blank" rel="noopener noreferrer" aria-label={`Open ${position.toLowerCase()} page in a new tab`} title="Open in a new tab">↗</a>
          </div>
          {invalidIndex === index && <span className="url-error" role="alert">Enter an HTTP or HTTPS URL.</span>}
          <iframe title={`${position} page`} src={loadedUrls[index]} referrerPolicy="strict-origin-when-cross-origin" />
        </section>
      ))}
    </main>
  );
}
