export const config = {

	// the smartbch node rpc interface to use for pulling data
	"api": {
		"apiType": "web3",
		"apiVersion": "v1",
		"network": "Mainnet",

		//"apiEndpoint": "http://nil.criptolayer.net:18545"
		"apiEndpoint": "https://smartbch.fountainhead.cash/mainnet:8545"
		// "apiEndpoint": "https://smartbch.fountainhead.cash/mainnet"
		// "apiEndpoint": "https://global.uat.cash"
		// "apiEndpoint": "https://rpc.uatvo.com"
		// "apiEndpoint": "https://moeing.tech:9545"
	},	

	// list the smartbch account adresses you want to export data for
	"my_addresses": [ 
		// "0xabc123...", 
		// "0xdef456...", 
	],

	// output configuration
	"output": { 
		"decimals": 18,
		"separate_file_per_contract": false,
	}
}
