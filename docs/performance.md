# Performance Notes

## v0.4 - Build Optimization (2026-03-04)

### Chunking Strategy

The production build now uses manual code-splitting via Vite's `rollupOptions.output.manualChunks`:

| Chunk | Contents | Size (gzip) |
|-------|----------|-------------|
| `vendor-react` | react, react-dom, react-router-dom | 50.68 kB |
| `vendor-charts` | recharts | 102.95 kB |
| `vendor-query` | @tanstack/react-query | 14.37 kB |
| `vendor-icons` | lucide-react | 1.76 kB |
| `vendor-utils` | clsx | 0.24 kB |
| `index` (main) | App code | 5.63 kB |

### Initial Load Optimization

- **Total initial JS**: ~175 kB gzipped (down from single 174 kB chunk)
- **Lazy load**: Charts (`recharts`) are in their own chunk and can be loaded on-demand
- **Critical path**: `index.js` is now only 5.63 kB - fast initial paint

### Build Output

```
dist/assets/index-3D4Og_5h.css          12.20 kB │ gzip:   3.10 kB
dist/assets/vendor-utils-B-dksMZM.js     0.37 kB │ gzip:   0.24 kB
dist/assets/vendor-icons-BZtr4SR-.js     6.72 kB │ gzip:   1.76 kB
dist/assets/index-BarOLaHH.js           26.07 kB │ gzip:   5.63 kB
dist/assets/vendor-query-CpX49aQo.js    46.45 kB │ gzip:  14.37 kB
dist/assets/vendor-react-DcmUutso.js   154.69 kB │ gzip:  50.68 kB
dist/assets/vendor-charts-qPf37wzN.js  371.66 kB │ gzip: 102.95 kB
```

### Trade-offs

- **Pro**: Smaller initial bundle, better caching (vendor chunks stable)
- **Con**: More HTTP requests (7 vs 1)
- **Mitigation**: Use HTTP/2 multiplexing; CDN caching

### Future Improvements

1. Consider dynamic import for routes to further split app code
2. Add `preload` hints for critical chunks
3. Analyze with Lighthouse for real-user metrics