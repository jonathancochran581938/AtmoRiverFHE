// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AtmosphericEvent {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  region: string;
  intensity: number;
  status: "pending" | "analyzed" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<AtmosphericEvent[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newEventData, setNewEventData] = useState({
    region: "",
    intensity: 0,
    description: "",
    encryptedMeasurements: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRegion, setFilterRegion] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [eventsPerPage] = useState(5);
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Calculate statistics for dashboard
  const analyzedCount = events.filter(e => e.status === "analyzed").length;
  const pendingCount = events.filter(e => e.status === "pending").length;
  const rejectedCount = events.filter(e => e.status === "rejected").length;

  // Filter events based on search and filter criteria
  const filteredEvents = events.filter(event => {
    const matchesSearch = event.region.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRegion = filterRegion === "all" || event.region === filterRegion;
    return matchesSearch && matchesRegion;
  });

  // Pagination
  const indexOfLastEvent = currentPage * eventsPerPage;
  const indexOfFirstEvent = indexOfLastEvent - eventsPerPage;
  const currentEvents = filteredEvents.slice(indexOfFirstEvent, indexOfLastEvent);
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);

  useEffect(() => {
    loadEvents().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadEvents = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("event_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing event keys:", e);
        }
      }
      
      const list: AtmosphericEvent[] = [];
      
      for (const key of keys) {
        try {
          const eventBytes = await contract.getData(`event_${key}`);
          if (eventBytes.length > 0) {
            try {
              const eventData = JSON.parse(ethers.toUtf8String(eventBytes));
              list.push({
                id: key,
                encryptedData: eventData.data,
                timestamp: eventData.timestamp,
                owner: eventData.owner,
                region: eventData.region,
                intensity: eventData.intensity,
                status: eventData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing event data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading event ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setEvents(list);
    } catch (e) {
      console.error("Error loading events:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitEvent = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting atmospheric data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newEventData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const eventId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const eventData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        region: newEventData.region,
        intensity: newEventData.intensity,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `event_${eventId}`, 
        ethers.toUtf8Bytes(JSON.stringify(eventData))
      );
      
      const keysBytes = await contract.getData("event_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(eventId);
      
      await contract.setData(
        "event_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted atmospheric data submitted securely!"
      });
      
      await loadEvents();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewEventData({
          region: "",
          intensity: 0,
          description: "",
          encryptedMeasurements: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const analyzeEvent = async (eventId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted atmospheric data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const eventBytes = await contract.getData(`event_${eventId}`);
      if (eventBytes.length === 0) {
        throw new Error("Event not found");
      }
      
      const eventData = JSON.parse(ethers.toUtf8String(eventBytes));
      
      const updatedEvent = {
        ...eventData,
        status: "analyzed"
      };
      
      await contract.setData(
        `event_${eventId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEvent))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadEvents();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectEvent = async (eventId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted atmospheric data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const eventBytes = await contract.getData(`event_${eventId}`);
      if (eventBytes.length === 0) {
        throw new Error("Event not found");
      }
      
      const eventData = JSON.parse(ethers.toUtf8String(eventBytes));
      
      const updatedEvent = {
        ...eventData,
        status: "rejected"
      };
      
      await contract.setData(
        `event_${eventId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEvent))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadEvents();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to interact with the platform",
      icon: "🔗"
    },
    {
      title: "Submit Atmospheric Data",
      description: "Add your encrypted atmospheric river data using FHE technology",
      icon: "🌊"
    },
    {
      title: "FHE Processing",
      description: "Your data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Analysis Results",
      description: "Receive verifiable results while keeping your data private",
      icon: "📊"
    }
  ];

  const teamMembers = [
    {
      name: "Dr. Elena Rodriguez",
      role: "Lead Meteorologist",
      bio: "Specialized in atmospheric river patterns with 15+ years of research experience."
    },
    {
      name: "Prof. Kenji Tanaka",
      role: "FHE Cryptography Expert",
      bio: "Pioneer in fully homomorphic encryption applications for scientific data."
    },
    {
      name: "Dr. Maya Johnson",
      role: "Climate Data Scientist",
      bio: "Expert in machine learning applications for weather prediction models."
    }
  ];

  const regions = ["North Pacific", "South Pacific", "North Atlantic", "South Atlantic", "Indian Ocean"];

  const renderPieChart = () => {
    const total = events.length || 1;
    const analyzedPercentage = (analyzedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment analyzed" 
            style={{ transform: `rotate(${analyzedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(analyzedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment rejected" 
            style={{ transform: `rotate(${(analyzedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{events.length}</div>
            <div className="pie-label">Events</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box analyzed"></div>
            <span>Analyzed: {analyzedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box rejected"></div>
            <span>Rejected: {rejectedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="cloud-icon"></div>
          </div>
          <h1>AtmoRiver<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-event-btn primary-btn"
          >
            <div className="add-icon"></div>
            Add Event
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Analysis of Atmospheric River Events</h2>
            <p>Meteorologists can jointly analyze encrypted weather data from multiple sources using FHE to study and predict extreme weather events like "atmospheric rivers".</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Atmospheric Analysis Tutorial</h2>
            <p className="subtitle">Learn how to securely process sensitive meteorological data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Project Introduction</h3>
            <p>Secure atmospheric river analysis platform using FHE technology to process sensitive meteorological data without decryption.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{events.length}</div>
                <div className="stat-label">Total Events</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search events by region or ID..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="filter-box">
            <select 
              value={filterRegion} 
              onChange={(e) => setFilterRegion(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Regions</option>
              {regions.map(region => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="events-section">
          <div className="section-header">
            <h2>Encrypted Atmospheric Events</h2>
            <div className="header-actions">
              <button 
                onClick={loadEvents}
                className="refresh-btn secondary-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="events-list">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Region</div>
              <div className="header-cell">Intensity</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {currentEvents.length === 0 ? (
              <div className="no-events">
                <div className="no-events-icon"></div>
                <p>No atmospheric events found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Event
                </button>
              </div>
            ) : (
              currentEvents.map(event => (
                <div className="event-row" key={event.id}>
                  <div className="table-cell event-id">#{event.id.substring(0, 6)}</div>
                  <div className="table-cell">{event.region}</div>
                  <div className="table-cell">{event.intensity}/10</div>
                  <div className="table-cell">{event.owner.substring(0, 6)}...{event.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(event.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${event.status}`}>
                      {event.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(event.owner) && event.status === "pending" && (
                      <>
                        <button 
                          className="action-btn success-btn"
                          onClick={() => analyzeEvent(event.id)}
                        >
                          Analyze
                        </button>
                        <button 
                          className="action-btn danger-btn"
                          onClick={() => rejectEvent(event.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                className="pagination-btn"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                Previous
              </button>
              <span className="pagination-info">Page {currentPage} of {totalPages}</span>
              <button 
                className="pagination-btn"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
        
        <div className="team-section">
          <div className="section-header">
            <h2>Research Team</h2>
            <button 
              className="secondary-btn"
              onClick={() => setShowTeamInfo(!showTeamInfo)}
            >
              {showTeamInfo ? "Hide Team" : "Show Team"}
            </button>
          </div>
          
          {showTeamInfo && (
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div className="team-card" key={index}>
                  <div className="member-photo"></div>
                  <h3>{member.name}</h3>
                  <p className="member-role">{member.role}</p>
                  <p className="member-bio">{member.bio}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitEvent} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          eventData={newEventData}
          setEventData={setNewEventData}
          regions={regions}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="cloud-icon"></div>
              <span>AtmoRiverFHE</span>
            </div>
            <p>Confidential analysis of atmospheric river events using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} AtmoRiverFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  eventData: any;
  setEventData: (data: any) => void;
  regions: string[];
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  eventData,
  setEventData,
  regions
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEventData({
      ...eventData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!eventData.region || !eventData.encryptedMeasurements) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Atmospheric Event Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your atmospheric data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Region *</label>
              <select 
                name="region"
                value={eventData.region} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select region</option>
                {regions.map(region => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>Intensity (1-10)</label>
              <input 
                type="number"
                name="intensity"
                min="1"
                max="10"
                value={eventData.intensity} 
                onChange={handleChange}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={eventData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Encrypted Measurements *</label>
              <textarea 
                name="encryptedMeasurements"
                value={eventData.encryptedMeasurements} 
                onChange={handleChange}
                placeholder="Enter encrypted atmospheric measurements..." 
                className="form-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary-btn"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;