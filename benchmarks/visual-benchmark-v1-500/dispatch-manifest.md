# Visual benchmark v1: 500-company capture dispatch

Run every command from `/Users/hendrik/Documents/logo-yoink`. The frozen assignment authority is `benchmarks/visual-benchmark-v1-500/benchmark-manifest.json`; each task owns exactly one 50-company shard and writes to a disjoint worker directory. `--resume` reuses completed entity captures and safely rebuilds that worker's aggregate files.

The capture CLI currently requires a `fixture_companies` fixture, so the existing pilot fixture is supplied only as the CLI's fixture-shaped metadata input. The 500-company assignment manifest remains authoritative and selects all companies in each shard.

## Capture task 00

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-00.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-00`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-00 --shard-index 0 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 01

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-01.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-01`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-01 --shard-index 1 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 02

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-02.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-02`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-02 --shard-index 2 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 03

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-03.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-03`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-03 --shard-index 3 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 04

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-04.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-04`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-04 --shard-index 4 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 05

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-05.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-05`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-05 --shard-index 5 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 06

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-06.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-06`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-06 --shard-index 6 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 07

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-07.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-07`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-07 --shard-index 7 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 08

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-08.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-08`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-08 --shard-index 8 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Capture task 09

Assignment: `benchmarks/visual-benchmark-v1-500/shards/assignments/capture-09.jsonl`  
Output: `runs/visual-benchmark-v1-500-v1/workers/capture-09`

```sh
node scripts/benchmark/visual-capture.mjs --fixture fixtures/visual-benchmark-pilot-20.json --assignment-root benchmarks/visual-benchmark-v1-500 --assignment-manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1 --worker-id capture-09 --shard-index 9 --shard-count 10 --resume --timeout-ms 15000 --hydration-ms 700 --max-requests 200 --max-transfer-bytes 26214400 --max-full-height 4000 --max-tiles 4 --max-instances 240 --max-crops 96
```

## Merge after all ten workers finish

The merge target must not already contain a benchmark manifest; do not pass `--force` during the first production merge.

```sh
node scripts/visual-benchmark-merge.mjs --manifest benchmarks/visual-benchmark-v1-500/benchmark-manifest.json --output runs/visual-benchmark-v1-500-v1/merged --input runs/visual-benchmark-v1-500-v1/workers/capture-00 --input runs/visual-benchmark-v1-500-v1/workers/capture-01 --input runs/visual-benchmark-v1-500-v1/workers/capture-02 --input runs/visual-benchmark-v1-500-v1/workers/capture-03 --input runs/visual-benchmark-v1-500-v1/workers/capture-04 --input runs/visual-benchmark-v1-500-v1/workers/capture-05 --input runs/visual-benchmark-v1-500-v1/workers/capture-06 --input runs/visual-benchmark-v1-500-v1/workers/capture-07 --input runs/visual-benchmark-v1-500-v1/workers/capture-08 --input runs/visual-benchmark-v1-500-v1/workers/capture-09
```

Then validate the merged run:

```sh
node scripts/visual-benchmark-validate.mjs --input runs/visual-benchmark-v1-500-v1/merged --strict
```
