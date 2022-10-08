#!/bin/bash
#SBCH_ENDPOINT="https://smartbch.fountainhead.cash/mainnet:8545"
SBCH_ENDPOINT="http://blackbox:8545"

result1=`curl -s -X POST ${SBCH_ENDPOINT} -H "Content-Type: application/json" \
-d '{"jsonrpc": "2.0", "method": "eth_getLogs", "params": [{"address": "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72", "fromBlock": "0xf1b30", "toBlock": "0x10a1cf", "topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}], "id": 1}' | jq '.result | length'`

echo "--- requested blocks 990000 to 1089999, got ${result1} items"

result2a=`curl -s -X POST ${SBCH_ENDPOINT} -H "Content-Type: application/json" \
-d '{"jsonrpc": "2.0", "method": "eth_getLogs", "params": [{"address": "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72", "fromBlock": "0xf1b30", "toBlock": "0xfde7f", "topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}], "id": 1}' | jq '.result | length'`
echo "--- requested blocks 990000 to 1039999, got ${result2a} items"
result2b=`curl -s -X POST ${SBCH_ENDPOINT} -H "Content-Type: application/json" \
-d '{"jsonrpc": "2.0", "method": "eth_getLogs", "params": [{"address": "0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72", "fromBlock": "0xfde80", "toBlock": "0x10a1cf", "topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}], "id": 1}' | jq '.result | length'`
echo "--- requested blocks 1040000 to 1089999, got ${result2b} items"

echo "$result2a + $result2b = $[ $result2a + $result2b ], should be $result1"
