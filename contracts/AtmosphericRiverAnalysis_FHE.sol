// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AtmosphericRiverAnalysis_FHE is SepoliaConfig {
    struct EncryptedWeatherData {
        uint256 stationId;
        euint32 encryptedPrecipitation;
        euint32 encryptedWindSpeed;
        euint32 encryptedHumidity;
        euint32 encryptedPressure;
        uint256 timestamp;
        address provider;
    }

    struct RiverForecast {
        euint32 encryptedIntensity;
        euint32 encryptedDuration;
        euint32 encryptedRiskLevel;
    }

    struct DecryptedForecast {
        uint32 intensity;
        uint32 duration;
        uint32 riskLevel;
        bool isRevealed;
    }

    uint256 public stationCount;
    mapping(uint256 => EncryptedWeatherData) public weatherData;
    mapping(uint256 => RiverForecast) public forecasts;
    mapping(uint256 => DecryptedForecast) public decryptedForecasts;

    mapping(uint256 => uint256) private requestToStationId;
    
    event DataSubmitted(uint256 indexed stationId, address indexed provider, uint256 timestamp);
    event ForecastGenerated(uint256 indexed stationId);
    event ForecastDecrypted(uint256 indexed stationId);

    function registerStation(address provider) public returns (uint256) {
        stationCount += 1;
        return stationCount;
    }

    function submitEncryptedData(
        euint32 encryptedPrecipitation,
        euint32 encryptedWindSpeed,
        euint32 encryptedHumidity,
        euint32 encryptedPressure,
        address provider
    ) public {
        uint256 stationId = registerStation(provider);
        
        weatherData[stationId] = EncryptedWeatherData({
            stationId: stationId,
            encryptedPrecipitation: encryptedPrecipitation,
            encryptedWindSpeed: encryptedWindSpeed,
            encryptedHumidity: encryptedHumidity,
            encryptedPressure: encryptedPressure,
            timestamp: block.timestamp,
            provider: provider
        });

        generateForecast(stationId);
        emit DataSubmitted(stationId, provider, block.timestamp);
    }

    function generateForecast(uint256 stationId) private {
        EncryptedWeatherData storage data = weatherData[stationId];
        
        forecasts[stationId] = RiverForecast({
            encryptedIntensity: FHE.add(
                FHE.mul(data.encryptedPrecipitation, FHE.asEuint32(3)),
                FHE.div(data.encryptedHumidity, FHE.asEuint32(2))
            ),
            encryptedDuration: FHE.mul(
                data.encryptedWindSpeed,
                FHE.asEuint32(5)
            ),
            encryptedRiskLevel: FHE.div(
                FHE.add(data.encryptedPressure, data.encryptedPrecipitation),
                FHE.asEuint32(2)
            )
        });

        decryptedForecasts[stationId] = DecryptedForecast({
            intensity: 0,
            duration: 0,
            riskLevel: 0,
            isRevealed: false
        });

        emit ForecastGenerated(stationId);
    }

    function requestForecastDecryption(uint256 stationId) public {
        require(msg.sender == weatherData[stationId].provider, "Not data provider");
        require(!decryptedForecasts[stationId].isRevealed, "Already decrypted");

        RiverForecast storage forecast = forecasts[stationId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(forecast.encryptedIntensity);
        ciphertexts[1] = FHE.toBytes32(forecast.encryptedDuration);
        ciphertexts[2] = FHE.toBytes32(forecast.encryptedRiskLevel);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptForecast.selector);
        requestToStationId[reqId] = stationId;
    }

    function decryptForecast(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 stationId = requestToStationId[requestId];
        require(stationId != 0, "Invalid request");

        DecryptedForecast storage dForecast = decryptedForecasts[stationId];
        require(!dForecast.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint32 intensity, uint32 duration, uint32 risk) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
        
        dForecast.intensity = intensity;
        dForecast.duration = duration;
        dForecast.riskLevel = risk;
        dForecast.isRevealed = true;

        emit ForecastDecrypted(stationId);
    }

    function requestDataDecryption(uint256 stationId) public {
        require(msg.sender == weatherData[stationId].provider, "Not data provider");
        
        EncryptedWeatherData storage data = weatherData[stationId];
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(data.encryptedPrecipitation);
        ciphertexts[1] = FHE.toBytes32(data.encryptedWindSpeed);
        ciphertexts[2] = FHE.toBytes32(data.encryptedHumidity);
        ciphertexts[3] = FHE.toBytes32(data.encryptedPressure);
        
        FHE.requestDecryption(ciphertexts, this.decryptWeatherData.selector);
    }

    function decryptWeatherData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        FHE.checkSignatures(requestId, cleartexts, proof);
        (uint32 precipitation, uint32 windSpeed, uint32 humidity, uint32 pressure) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32));
        // Process decrypted weather data as needed
    }

    function getStationCount() public view returns (uint256) {
        return stationCount;
    }
}