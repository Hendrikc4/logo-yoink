# Initial extraction benchmark

The first Logo Yoink pipeline was tested against a fixed sample of 100 random company websites from StartupSeeker.

| Method | Valid images | Square/high-quality images |
|---|---:|---:|
| Custom favicon extraction | 70 | 33 |
| Custom + Schema.org + manifest/Apple icons | 70 | 48 |
| Metascraper logo + favicon | 64 | 40 |
| Besticon | 67 | 48 |
| branding-go, best logo/favicon | 68 | 47 |
| Union of all working methods | 75 | 53 |

The custom manifest and Schema.org rules improved quality rather than raw retrieval: high-quality square results increased from 33 to 48. Adding every tested open-source method raised the automated upper bound to 75 valid and 53 high-quality square results.

Besticon was the strongest fallback, but it recovered four sites while missing seven sites found by the custom extractor. It should therefore augment rather than replace the native pipeline.

The five raw additions from the library union included one wide wordmark and several borderline assets. Visual inspection reduced the apparent improvement to approximately three clearly strong quality wins plus two conditionally useful results. Logo Yoink consequently returns ranked candidates and their provenance rather than presenting its first choice as certain.

Google S2 and generated letter fallbacks were excluded from the benchmark. All counted results were downloaded and validated as actual image bytes.
