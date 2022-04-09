export const config = {

	// the smartbch node rpc interface to use for pulling data
	"api": {
		"apiType": "web3",
		"apiVersion": "v1",
		"network": "Mainnet",

		"apiEndpoint": "https://smartbch.fountainhead.cash/mainnet:8545"
		// "apiEndpoint": "https://smartbch.fountainhead.cash/mainnet"
		// "apiEndpoint": "https://global.uat.cash"
		// "apiEndpoint": "https://rpc.uatvo.com"
		// "apiEndpoint": "https://moeing.tech:9545"
	},	

	// list the smartbch account adresses you want to export data for
	"my_addresses": [ 
		"0x9f20a29cb0615d37dBa2aD7A2679e4cb09A5cf11", // molecular test account
		// "0xabc123...", // more accounts
	],

	// list of contracts to extract data for, use names from assets/config/contract.json
	"contracts": [ 
		"flexUSD",
	],

	// used to write the CSV columns post-fixed with "_" which are formatted copies
	"output": { 
		"divider_e": 18, // should depend on individual contract, but const short-cut for now
		"decimals": 2
	}
}
