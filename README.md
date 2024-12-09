# EVMole datasets

Datasets for [EVMole benchmarks](https://github.com/cdump/evmole/tree/master/benchmark)

## How datasets was constructed

1. Clone [tintinweb/smart-contract-sanctuary](https://github.com/tintinweb/smart-contract-sanctuary)

2. Find all solidity contracts:
```sh
$ cd smart-contract-sanctuary/ethereum/contracts/mainnet/

# (contract_size_in_bytes) (contract_file_path)
$ find ./ -name "*.sol" -printf "%s %p\n" > all.txt
```

3. Get ~1200 largest (by size) contracts:
```sh
$ cat all.txt | sort -rn | head -n 1200 | cut -d'/' -f3 | cut -d'_' -f1 > top.txt
```

4. Get ~55.000 random contracts
```sh
$ cat all.txt | cut -d'/' -f3 | cut -d'_' -f1 | sort -u | shuf | head -n 55000 > random.txt
```

5. Get all vyper contracts:
```sh
$ find ./ -type f -name '*.vy' | cut -d'/' -f3 | cut -d'_' -f1 > vyper.txt
```

6. Download contracts code & abi (using scripts/etherscan):
```sh
$ poetry run python3 download.py --etherscan-api-key=CHANGE_ME --addrs-list=top.txt --out-dir=datasets/largest1k --limit=1000 --code-regexp='^0x(?!73).'
$ poetry run python3 download.py --etherscan-api-key=CHANGE_ME --addrs-list=random.txt --out-dir=datasets/random50k --limit=50000 --code-regexp='^0x(?!73).'
$ poetry run python3 download.py --etherscan-api-key=CHANGE_ME --addrs-list=vyper.txt --out-dir=datasets/vyper --code-regexp='^0x(?!73).'
```

We use `--code-regexp='^0x(?!73).'` to:
1. Skip contract with empty code (`{"code": "0x",`) - these are self-destructed contracts.
2. Skip contract with code starting from `0x73` (`PUSH20` opcode).
Compiled Solidity libraries [begins with this code](https://docs.soliditylang.org/en/v0.8.23/contracts.html#call-protection-for-libraries), and because [Non-storage structs are referred to by their fully qualified name](https://docs.soliditylang.org/en/v0.8.23/contracts.html#function-signatures-and-selectors-in-libraries) it's not yet supported by our reference Etherscan extractor (`providers/etherscan`). This issue may be fixed later.
