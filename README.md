# EVMole Datasets

This repository contains smart contract datasets used for [EVMole benchmarks](https://github.com/cdump/evmole/tree/master/benchmark). The datasets include large Solidity contracts, randomly selected contracts, and Vyper contracts from the Ethereum mainnet.

## Dataset Construction Process

1. First, clone the source repository containing verified Ethereum smart contracts:
```sh
git clone https://github.com/tintinweb/smart-contract-sanctuary.git
```

2. Locate all Solidity contracts and record their sizes:
```sh
$ cd smart-contract-sanctuary/ethereum/contracts/mainnet/

# (contract_size_in_bytes) (contract_file_path)
$ find ./ -name "*.sol" -printf "%s %p\n" > all.txt
```

3. Extract approximately 1200 of the largest contracts by file size:
```sh
$ cat all.txt | sort -rn | head -n 1200 | cut -d'/' -f3 | cut -d'_' -f1 > top.txt
```

4. Select approximately 55,000 random contracts:
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

The `--code-regexp='^0x(?!73).'` parameter is used to filter contracts:
1. It skips contracts with empty code (`{"code": "0x",`), which are self-destructed contracts
2. It excludes contracts with code starting with `0x73` (the `PUSH20` opcode)

Note about excluded contracts: Compiled Solidity libraries [begin with the PUSH20 opcode](https://docs.soliditylang.org/en/v0.8.23/contracts.html#call-protection-for-libraries) for call protection. These are currently excluded because [non-storage structs are referred to by their fully qualified name](https://docs.soliditylang.org/en/v0.8.23/contracts.html#function-signatures-and-selectors-in-libraries), which is not yet supported by our reference Etherscan extractor (`providers/etherscan`). This limitation may be addressed in future updates.

7. Build the `storage` dataset (`/mnt/sourcify/sources` must contain the downloaded contracts):
```sh
$ cd scripts/sourcify
$ npm install
$ mkdir -p out/

# Process contracts in parallel (adjust -P16 for your CPU cores)
$ find /mnt/sourcify/sources/contracts/full_match/1 -mindepth 1 -maxdepth 1 -type d | shuf | head -n 4000 | xargs -n1 -P16 node index.mjs

# Select ~3000 unique contracts
$ md5sum out/* | sort | uniq -w 32 | shuf | head -n 3000 | awk '{print $2}' | xargs -I{} cp {} storage3k/
```
